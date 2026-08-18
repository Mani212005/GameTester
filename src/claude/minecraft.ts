import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { fakeNoise2D, playTone, installQAHook } from './shared';

type BlockName = 'grass' | 'dirt' | 'stone' | 'wood';
const BLOCK_ORDER: BlockName[] = ['grass', 'dirt', 'stone', 'wood'];
const BLOCK_COLOR: Record<BlockName, number> = {
  grass: 0x4ade80,
  dirt: 0x92400e,
  stone: 0x94a3b8,
  wood: 0xb45309,
};

const GRID = 22; // columns per side
const SPARE_PER_TYPE = 80;

interface TerrainResult {
  heights: Map<string, number>;
  columnCount: number;
}

function generateTerrain(): TerrainResult {
  const heights = new Map<string, number>();
  const half = Math.floor(GRID / 2);
  for (let x = -half; x < half; x++) {
    for (let z = -half; z < half; z++) {
      const raw = fakeNoise2D(x, z);
      const h = Math.max(-2, Math.min(3, Math.round(raw)));
      heights.set(`${x},${z}`, h);
    }
  }
  return { heights, columnCount: GRID * GRID };
}

export interface MinecraftOptions {
  container: HTMLElement;
  hudEl: HTMLElement | null;
  hotbarEl: HTMLElement | null;
  neutralHud: boolean;
}

interface PoolEntry {
  mesh: THREE.InstancedMesh;
  used: number;
  spareStart: number;
  capacity: number;
  keyByIndex: (string | null)[];
}

function makeDummyMatrix(): THREE.Matrix4 {
  return new THREE.Matrix4();
}

/** Canonical "one-shot" build: instanced voxels, shadow maps, inertia movement,
 * physics debris particles, procedural audio, live target outline. */
export function bootMinecraftCanonical(opts: MinecraftOptions) {
  const { container, hudEl, hotbarEl } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x74c7ec);
  scene.fog = new THREE.Fog(0x74c7ec, 22, 46);

  const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a2a1a, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d6, 1.35);
  sun.position.set(18, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.001;
  scene.add(sun);

  const { heights } = generateTerrain();

  // Count terrain blocks per type for pool sizing.
  const terrainCountByType: Record<BlockName, number> = { grass: 0, dirt: 0, stone: 0, wood: 0 };
  for (const h of heights.values()) {
    terrainCountByType.grass += 1;
    terrainCountByType.dirt += 2;
    terrainCountByType.stone += 1;
  }

  const pools: Record<BlockName, PoolEntry> = {} as any;
  for (const type of BLOCK_ORDER) {
    const capacity = terrainCountByType[type] + SPARE_PER_TYPE;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: BLOCK_COLOR[type], roughness: 0.9, metalness: 0.02 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(capacity, 1));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    scene.add(mesh);
    pools[type] = { mesh, used: 0, spareStart: terrainCountByType[type], capacity, keyByIndex: new Array(capacity).fill(null) };
  }

  const voxelIndex = new Map<string, { type: BlockName; idx: number }>();
  const dummy = makeDummyMatrix();

  function placeInstance(type: BlockName, x: number, y: number, z: number, idx?: number): number {
    const pool = pools[type];
    const index = idx ?? pool.used++;
    dummy.makeTranslation(x, y, z);
    pool.mesh.setMatrixAt(index, dummy);
    pool.mesh.count = Math.max(pool.mesh.count, index + 1);
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.keyByIndex[index] = `${x},${y},${z}`;
    voxelIndex.set(`${x},${y},${z}`, { type, idx: index });
    return index;
  }

  function hideInstance(type: BlockName, idx: number) {
    const pool = pools[type];
    dummy.makeScale(0, 0, 0);
    pool.mesh.setMatrixAt(idx, dummy);
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  for (const [key, h] of heights.entries()) {
    const [x, z] = key.split(',').map(Number);
    placeInstance('grass', x, h, z);
    placeInstance('dirt', x, h - 1, z);
    placeInstance('dirt', x, h - 2, z);
    placeInstance('stone', x, h - 3, z);
  }

  function heightAt(worldX: number, worldZ: number): number {
    const key = `${Math.round(worldX)},${Math.round(worldZ)}`;
    return heights.has(key) ? (heights.get(key) as number) : 0;
  }

  // --- Player ---
  const EYE_HEIGHT = 1.7;
  const controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.object);
  const startH = heightAt(0, 0);
  controls.object.position.set(0.5, startH + 0.5 + EYE_HEIGHT, 0.5);

  container.addEventListener('click', () => controls.lock());

  const keys = { fwd: false, back: false, left: false, right: false };
  let canJump = true;
  const velocity = new THREE.Vector3();
  const inputDir = new THREE.Vector3();
  const GRAVITY = 26;
  const JUMP_SPEED = 8.4;
  const ACCEL = 46;
  const DAMPING = 8.5;
  const MAX_SPEED = 6.4;

  window.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'KeyW': keys.fwd = true; break;
      case 'KeyS': keys.back = true; break;
      case 'KeyA': keys.left = true; break;
      case 'KeyD': keys.right = true; break;
      case 'Space': if (canJump) { velocity.y = JUMP_SPEED; canJump = false; } break;
      case 'Digit1': selectSlot(0); break;
      case 'Digit2': selectSlot(1); break;
      case 'Digit3': selectSlot(2); break;
      case 'Digit4': selectSlot(3); break;
    }
  });
  window.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW': keys.fwd = false; break;
      case 'KeyS': keys.back = false; break;
      case 'KeyA': keys.left = false; break;
      case 'KeyD': keys.right = false; break;
    }
  });

  // --- Hotbar / targeting ---
  let selectedIndex = 0;
  function selectSlot(i: number) {
    selectedIndex = i;
    if (!hotbarEl) return;
    Array.from(hotbarEl.children).forEach((c, ci) => c.classList.toggle('active', ci === i));
  }
  if (hotbarEl) {
    hotbarEl.innerHTML = '';
    BLOCK_ORDER.forEach((type, i) => {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot' + (i === 0 ? ' active' : '');
      const swatch = document.createElement('div');
      swatch.className = 'block-icon';
      swatch.style.background = `#${BLOCK_COLOR[type].toString(16).padStart(6, '0')}`;
      const num = document.createElement('span');
      num.className = 'slot-num';
      num.innerText = String(i + 1);
      const label = document.createElement('span');
      label.className = 'slot-name';
      label.innerText = type[0].toUpperCase() + type.slice(1);
      slot.append(num, swatch, label);
      hotbarEl.appendChild(slot);
    });
  }

  const raycaster = new THREE.Raycaster();
  raycaster.far = 7;
  const targetOutline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01)),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  targetOutline.visible = false;
  scene.add(targetOutline);

  let audioCtx: AudioContext | null = null;
  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    return audioCtx;
  }

  interface Debris { mesh: THREE.Mesh; body: CANNON.Body; life: number; }
  const debris: Debris[] = [];
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });

  function raycastTerrain(): { type: BlockName; idx: number; point: THREE.Vector3; normal: THREE.Vector3 } | null {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    let best: { type: BlockName; idx: number; dist: number; point: THREE.Vector3; normal: THREE.Vector3 } | null = null;
    for (const type of BLOCK_ORDER) {
      const hits = raycaster.intersectObject(pools[type].mesh);
      for (const hit of hits) {
        if (hit.instanceId === undefined) continue;
        const key = pools[type].keyByIndex[hit.instanceId];
        if (!key) continue;
        if (!best || hit.distance < best.dist) {
          best = {
            type,
            idx: hit.instanceId,
            dist: hit.distance,
            point: hit.point.clone(),
            normal: (hit.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0)).transformDirection(pools[type].mesh.matrixWorld),
          };
        }
      }
    }
    return best;
  }

  container.addEventListener('mousedown', (e) => {
    if (!controls.isLocked) return;
    const hit = raycastTerrain();
    if (!hit) return;
    const key = pools[hit.type].keyByIndex[hit.idx] as string;
    const [bx, by, bz] = key.split(',').map(Number);

    if (e.button === 0) {
      // break
      hideInstance(hit.type, hit.idx);
      pools[hit.type].keyByIndex[hit.idx] = null;
      voxelIndex.delete(key);
      spawnDebris(bx, by, bz, BLOCK_COLOR[hit.type]);
      playTone(ensureAudio(), 180, 90, 'square', 0.1);
    } else if (e.button === 2) {
      const placePos = new THREE.Vector3(bx, by, bz).add(hit.normal.clone().round());
      const placeKey = `${placePos.x},${placePos.y},${placePos.z}`;
      if (!voxelIndex.has(placeKey)) {
        const type = BLOCK_ORDER[selectedIndex];
        const pool = pools[type];
        if (pool.used < pool.capacity) {
          placeInstance(type, placePos.x, placePos.y, placePos.z, pool.used++);
          playTone(ensureAudio(), 320, 70, 'triangle', 0.08);
        }
      }
    }
  });
  container.addEventListener('contextmenu', (e) => e.preventDefault());

  function spawnDebris(x: number, y: number, z: number, color: number) {
    for (let i = 0; i < 18; i++) {
      const size = 0.14 + Math.random() * 0.1;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshStandardMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.position.set(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6);
      scene.add(mesh);
      const body = new CANNON.Body({ mass: 0.3, shape: new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2)) });
      body.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
      body.velocity.set((Math.random() - 0.5) * 4, Math.random() * 3.5 + 1, (Math.random() - 0.5) * 4);
      body.angularVelocity.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      world.addBody(body);
      debris.push({ mesh, body, life: 2.6 });
    }
  }

  // HUD
  if (hudEl) {
    const h1 = hudEl.querySelector('.mc-title');
    if (h1 && !opts.neutralHud) h1.innerHTML = 'Minecraft Voxel Engine <span class="badge">Claude one-shot</span>';
  }

  let stepCount = 0;
  let lastFrame = performance.now();
  let fpsSmoothed = 60;

  function getState() {
    const pos = controls.object.position;
    return {
      fps: Math.round(fpsSmoothed),
      stepCount,
      playerPos: { x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)), z: Number(pos.z.toFixed(2)) },
      playerVel: { x: Number(velocity.x.toFixed(2)), y: Number(velocity.y.toFixed(2)), z: Number(velocity.z.toFixed(2)) },
      isGrounded: canJump,
      activeDebris: debris.length,
      shadowMapQuality: 'PCFSoft 2048x2048',
      totalBlocks: Array.from(voxelIndex.keys()).length,
    };
  }

  installQAHook(getState, () => {
    stepCount++;
    return getState();
  });

  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const delta = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    fpsSmoothed += (1 / Math.max(delta, 0.0001) - fpsSmoothed) * 0.08;
    stepCount++;

    if (controls.isLocked) {
      velocity.x -= velocity.x * DAMPING * delta;
      velocity.z -= velocity.z * DAMPING * delta;

      inputDir.z = Number(keys.fwd) - Number(keys.back);
      inputDir.x = Number(keys.right) - Number(keys.left);
      if (inputDir.lengthSq() > 0) inputDir.normalize();

      velocity.x += inputDir.x * ACCEL * delta;
      velocity.z += inputDir.z * ACCEL * delta;
      velocity.x = THREE.MathUtils.clamp(velocity.x, -MAX_SPEED, MAX_SPEED);
      velocity.z = THREE.MathUtils.clamp(velocity.z, -MAX_SPEED, MAX_SPEED);

      controls.moveRight(velocity.x * delta);
      controls.moveForward(velocity.z * delta);

      velocity.y -= GRAVITY * delta;
      controls.object.position.y += velocity.y * delta;

      const groundY = heightAt(controls.object.position.x, controls.object.position.z) + 0.5 + EYE_HEIGHT;
      if (controls.object.position.y <= groundY) {
        velocity.y = 0;
        controls.object.position.y = groundY;
        canJump = true;
      }
    }

    world.step(1 / 60, delta, 3);
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.mesh.position.copy(d.body.position as any);
      d.mesh.quaternion.copy(d.body.quaternion as any);
      d.life -= delta;
      if (d.life <= 0 || d.body.position.y < -8) {
        scene.remove(d.mesh);
        world.removeBody(d.body);
        debris.splice(i, 1);
      }
    }

    const hit = raycastTerrain();
    if (hit) {
      const key = pools[hit.type].keyByIndex[hit.idx];
      if (key) {
        const [bx, by, bz] = key.split(',').map(Number);
        targetOutline.position.set(bx, by, bz);
        targetOutline.visible = true;
      } else {
        targetOutline.visible = false;
      }
    } else {
      targetOutline.visible = false;
    }

    if (hudEl) {
      const preview = hudEl.querySelector('.mc-state-preview');
      if (preview) preview.textContent = JSON.stringify(getState());
    }

    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}
