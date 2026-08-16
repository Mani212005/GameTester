import * as THREE from 'three';
import type { FPSOptions } from './fps';

const ARENA_HALF = 20;

interface Bot { mesh: THREE.Mesh; hp: number; alive: boolean; }

/** Baseline build: flat unlit shading, no line-of-sight reasoning (bots always
 * face and plink the player), bounding-box hit test instead of precise raycast,
 * binary movement, no muzzle flash / audio / particles. */
export function bootFPSBaseline(opts: FPSOptions) {
  const { container, hudEl } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1f2e);

  const camera = new THREE.PerspectiveCamera(78, container.clientWidth / container.clientHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2), new THREE.MeshBasicMaterial({ color: 0x33415c }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const pillarMat = new THREE.MeshBasicMaterial({ color: 0x4a5a78 });
  const pillars: THREE.Mesh[] = [];
  for (const [px, pz] of [[-8, -8], [8, -8], [-8, 8], [8, 8], [0, -12], [0, 12]] as [number, number][]) {
    const h = 4;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.6), pillarMat);
    pillar.position.set(px, h / 2, pz);
    scene.add(pillar);
    pillars.push(pillar);
  }

  const wallMat = new THREE.MeshBasicMaterial({ color: 0x272e42 });
  const wallHeight = 6;
  for (const w of [
    { pos: [0, wallHeight / 2, -ARENA_HALF], size: [ARENA_HALF * 2, wallHeight, 1] },
    { pos: [0, wallHeight / 2, ARENA_HALF], size: [ARENA_HALF * 2, wallHeight, 1] },
    { pos: [-ARENA_HALF, wallHeight / 2, 0], size: [1, wallHeight, ARENA_HALF * 2] },
    { pos: [ARENA_HALF, wallHeight / 2, 0], size: [1, wallHeight, ARENA_HALF * 2] },
  ]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]), wallMat);
    mesh.position.set(w.pos[0], w.pos[1], w.pos[2]);
    scene.add(mesh);
  }

  const EYE_HEIGHT = 1.7;
  camera.position.set(0, EYE_HEIGHT, 12);
  let yaw = 0, pitch = 0, pointerLocked = false;
  container.addEventListener('click', () => container.requestPointerLock());
  document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === container; });
  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = Math.max(-1.4, Math.min(1.4, pitch));
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  });

  const keys = { fwd: false, back: false, left: false, right: false };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') keys.fwd = true;
    if (e.code === 'KeyS') keys.back = true;
    if (e.code === 'KeyA') keys.left = true;
    if (e.code === 'KeyD') keys.right = true;
    if (e.code === 'KeyR') ammo.mag = 30;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') keys.fwd = false;
    if (e.code === 'KeyS') keys.back = false;
    if (e.code === 'KeyA') keys.left = false;
    if (e.code === 'KeyD') keys.right = false;
  });

  const SPEED = 5.6;
  const bots: Bot[] = [];
  function spawnBot(x: number, z: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.8), new THREE.MeshBasicMaterial({ color: 0xdc2626 }));
    mesh.position.set(x, 0.9, z);
    scene.add(mesh);
    bots.push({ mesh, hp: 100, alive: true });
  }
  spawnBot(-10, -10);
  spawnBot(10, -10);
  spawnBot(0, -16);
  spawnBot(-6, 4);

  let wave = 1;
  let score = 0;
  const ammo = { mag: 30, reserve: 120 };
  let playerHp = 100;
  let lastBotShot = 0;

  const raycaster = new THREE.Raycaster();
  function shoot() {
    if (!pointerLocked || ammo.mag <= 0) return;
    ammo.mag--;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    // Bounding-box approximation: any alive bot whose screen-space box overlaps the crosshair counts as a hit.
    const targets = bots.filter((b) => b.alive).map((b) => b.mesh);
    const hits = raycaster.intersectObjects(targets);
    if (hits.length > 0) {
      const bot = bots.find((b) => b.mesh === hits[0].object);
      if (bot) {
        bot.hp -= 50;
        if (bot.hp <= 0) {
          bot.alive = false;
          bot.mesh.visible = false;
          score += 100;
          if (bots.every((b) => !b.alive)) {
            wave++;
            score += 250;
            setTimeout(() => {
              for (const b of bots) { b.alive = true; b.hp = 100; b.mesh.visible = true; b.mesh.position.set((Math.random() - 0.5) * 24, 0.9, (Math.random() - 0.5) * 24 - 6); }
            }, 1200);
          }
        }
      }
    }
  }
  container.addEventListener('mousedown', (e) => { if (e.button === 0) shoot(); });

  function getState() {
    return {
      fps: Math.round(fpsSmoothed),
      stepCount,
      playerPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      playerHp,
      ammoMag: ammo.mag,
      ammoReserve: ammo.reserve,
      wave,
      score,
      botsAlive: bots.filter((b) => b.alive).length,
      lighting: 'flat directional (no shadow maps)',
    };
  }
  (window as any).qaHook = { getSceneState: getState, step: () => { stepCount++; return getState(); } };

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
      camera.position.x = THREE.MathUtils.clamp(camera.position.x + move.x * delta, -ARENA_HALF + 1, ARENA_HALF - 1);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z + move.z * delta, -ARENA_HALF + 1, ARENA_HALF - 1);

      // Bots always know exactly where the player is - no line-of-sight check - and turn instantly to face.
      for (const bot of bots) {
        if (!bot.alive) continue;
        bot.mesh.lookAt(camera.position.x, bot.mesh.position.y, camera.position.z);
      }
      if (now - lastBotShot > 900) {
        lastBotShot = now;
        const aliveBots = bots.filter((b) => b.alive);
        if (aliveBots.length > 0 && Math.random() < 0.5) playerHp = Math.max(0, playerHp - 8);
      }
    }

    if (hudEl) {
      const preview = hudEl.querySelector('.fps-state-preview');
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
