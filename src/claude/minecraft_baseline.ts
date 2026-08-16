import * as THREE from 'three';
import { fakeNoise2D } from './shared';
import type { MinecraftOptions } from './minecraft';

type BlockName = 'grass' | 'dirt' | 'stone' | 'wood';
const BLOCK_ORDER: BlockName[] = ['grass', 'dirt', 'stone', 'wood'];
const BLOCK_COLOR: Record<BlockName, number> = {
  grass: 0x4ade80,
  dirt: 0x92400e,
  stone: 0x94a3b8,
  wood: 0xb45309,
};
const GRID = 22;

/** Baseline build: same world layout, flat unlit shading, binary movement,
 * instant block removal, no particles/audio/outline - the simpler paradigm. */
export function bootMinecraftBaseline(opts: MinecraftOptions) {
  const { container, hudEl, hotbarEl } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  const camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const heights = new Map<string, number>();
  const half = Math.floor(GRID / 2);
  for (let x = -half; x < half; x++) {
    for (let z = -half; z < half; z++) {
      heights.set(`${x},${z}`, Math.max(-2, Math.min(3, Math.round(fakeNoise2D(x, z)))));
    }
  }

  const voxelIndex = new Map<string, THREE.Mesh>();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const matCache: Record<BlockName, THREE.MeshBasicMaterial> = {
    grass: new THREE.MeshBasicMaterial({ color: BLOCK_COLOR.grass }),
    dirt: new THREE.MeshBasicMaterial({ color: BLOCK_COLOR.dirt }),
    stone: new THREE.MeshBasicMaterial({ color: BLOCK_COLOR.stone }),
    wood: new THREE.MeshBasicMaterial({ color: BLOCK_COLOR.wood }),
  };

  function addBlock(type: BlockName, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(geo, matCache[type]);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    voxelIndex.set(`${x},${y},${z}`, mesh);
  }

  for (const [key, h] of heights.entries()) {
    const [x, z] = key.split(',').map(Number);
    addBlock('grass', x, h, z);
    addBlock('dirt', x, h - 1, z);
    addBlock('dirt', x, h - 2, z);
    addBlock('stone', x, h - 3, z);
  }

  function heightAt(worldX: number, worldZ: number): number {
    const key = `${Math.round(worldX)},${Math.round(worldZ)}`;
    return heights.has(key) ? (heights.get(key) as number) : 0;
  }

  const EYE_HEIGHT = 1.7;
  camera.position.set(0.5, heightAt(0, 0) + 0.5 + EYE_HEIGHT, 0.5);

  let yaw = 0;
  let pitch = 0;
  let pointerLocked = false;
  container.addEventListener('click', () => container.requestPointerLock());
  document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === container; });
  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  });

  const keys = { fwd: false, back: false, left: false, right: false };
  let selectedIndex = 0;
  window.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'KeyW': keys.fwd = true; break;
      case 'KeyS': keys.back = true; break;
      case 'KeyA': keys.left = true; break;
      case 'KeyD': keys.right = true; break;
      case 'Space': velocity.y = 7.5; break;
      case 'Digit1': selectSlot(0); break;
      case 'Digit2': selectSlot(1); break;
      case 'Digit3': selectSlot(2); break;
      case 'Digit4': selectSlot(3); break;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') keys.fwd = false;
    if (e.code === 'KeyS') keys.back = false;
    if (e.code === 'KeyA') keys.left = false;
    if (e.code === 'KeyD') keys.right = false;
  });

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

  const velocity = new THREE.Vector3();
  const GRAVITY = 24;
  const SPEED = 5.2;

  const raycaster = new THREE.Raycaster();
  raycaster.far = 6.5;
  function raycastTerrain(): THREE.Mesh | null {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects(Array.from(voxelIndex.values()));
    return hits.length > 0 ? (hits[0].object as THREE.Mesh) : null;
  }

  container.addEventListener('mousedown', (e) => {
    if (!pointerLocked) return;
    const hit = raycastTerrain();
    if (!hit) return;
    if (e.button === 0) {
      scene.remove(hit);
      for (const [k, v] of voxelIndex.entries()) if (v === hit) { voxelIndex.delete(k); break; }
    } else if (e.button === 2) {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const intersect = raycaster.intersectObject(hit)[0];
      if (intersect && intersect.face) {
        const normal = intersect.face.normal.clone();
        const placePos = hit.position.clone().add(normal);
        const key = `${Math.round(placePos.x)},${Math.round(placePos.y)},${Math.round(placePos.z)}`;
        if (!voxelIndex.has(key)) addBlock(BLOCK_ORDER[selectedIndex], Math.round(placePos.x), Math.round(placePos.y), Math.round(placePos.z));
      }
    }
  });
  container.addEventListener('contextmenu', (e) => e.preventDefault());

  let stepCount = 0;
  let lastFrame = performance.now();
  let fpsSmoothed = 60;

  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const delta = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    fpsSmoothed += (1 / Math.max(delta, 0.0001) - fpsSmoothed) * 0.08;
    stepCount++;

    if (pointerLocked) {
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const move = new THREE.Vector3();
      if (keys.fwd) move.add(fwd);
      if (keys.back) move.sub(fwd);
      if (keys.right) move.add(right);
      if (keys.left) move.sub(right);
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(SPEED);
      camera.position.x += move.x * delta;
      camera.position.z += move.z * delta;

      velocity.y -= GRAVITY * delta;
      camera.position.y += velocity.y * delta;
      const groundY = heightAt(camera.position.x, camera.position.z) + 0.5 + EYE_HEIGHT;
      if (camera.position.y <= groundY) {
        velocity.y = 0;
        camera.position.y = groundY;
      }
    }

    if (hudEl) {
      const preview = hudEl.querySelector('.mc-state-preview');
      if (preview) {
        preview.textContent = JSON.stringify({
          fps: Math.round(fpsSmoothed),
          stepCount,
          playerPos: { x: Number(camera.position.x.toFixed(2)), y: Number(camera.position.y.toFixed(2)), z: Number(camera.position.z.toFixed(2)) },
          totalBlocks: voxelIndex.size,
        });
      }
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
