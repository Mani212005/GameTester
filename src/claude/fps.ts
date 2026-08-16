import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { playTone, installQAHook } from './shared';

interface Bot {
  mesh: THREE.Group;
  head: THREE.Mesh;
  hp: number;
  alive: boolean;
  state: 'patrol' | 'chase' | 'attack';
  patrolTarget: THREE.Vector3;
  lastShot: number;
}

export interface FPSOptions {
  container: HTMLElement;
  hudEl: HTMLElement | null;
  neutralHud: boolean;
}

const ARENA_HALF = 20;

export function bootFPSCanonical(opts: FPSOptions) {
  const { container, hudEl } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2032);
  scene.fog = new THREE.Fog(0x1a2032, 24, 60);

  const camera = new THREE.PerspectiveCamera(78, container.clientWidth / container.clientHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0x7080a0, 1.7);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0x6a7ab0, 0x161c2a, 1.3);
  scene.add(hemi);
  const redSpot = new THREE.SpotLight(0xff3b3b, 260, 45, Math.PI / 5, 0.5, 0);
  redSpot.position.set(-14, 12, -10);
  redSpot.castShadow = true;
  redSpot.shadow.mapSize.set(1024, 1024);
  redSpot.shadow.bias = -0.003;
  scene.add(redSpot);
  const blueSpot = new THREE.SpotLight(0x3b8bff, 260, 45, Math.PI / 5, 0.5, 0);
  blueSpot.position.set(14, 12, 10);
  blueSpot.castShadow = true;
  blueSpot.shadow.mapSize.set(1024, 1024);
  blueSpot.shadow.bias = -0.003;
  scene.add(blueSpot);

  // Arena floor + walls
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2e3a52, roughness: 0.85 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x4a5a7a, roughness: 0.6 });
  const pillars: THREE.Mesh[] = [];
  const pillarPositions: [number, number][] = [[-8, -8], [8, -8], [-8, 8], [8, 8], [0, -12], [0, 12]];
  for (const [px, pz] of pillarPositions) {
    const h = 3.4 + Math.random() * 1.5;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.6), pillarMat);
    pillar.position.set(px, h / 2, pz);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    scene.add(pillar);
    pillars.push(pillar);
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x566688, roughness: 0.85 });
  const wallHeight = 11;
  const walls = [
    { pos: [0, wallHeight / 2, -ARENA_HALF], size: [ARENA_HALF * 2, wallHeight, 1] },
    { pos: [0, wallHeight / 2, ARENA_HALF], size: [ARENA_HALF * 2, wallHeight, 1] },
    { pos: [-ARENA_HALF, wallHeight / 2, 0], size: [1, wallHeight, ARENA_HALF * 2] },
    { pos: [ARENA_HALF, wallHeight / 2, 0], size: [1, wallHeight, ARENA_HALF * 2] },
  ];
  for (const w of walls) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]), wallMat);
    mesh.position.set(w.pos[0], w.pos[1], w.pos[2]);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // --- Player ---
  const EYE_HEIGHT = 1.7;
  const controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.object);
  controls.object.position.set(0, EYE_HEIGHT, 12);
  container.addEventListener('click', () => controls.lock());

  const keys = { fwd: false, back: false, left: false, right: false };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') keys.fwd = true;
    if (e.code === 'KeyS') keys.back = true;
    if (e.code === 'KeyA') keys.left = true;
    if (e.code === 'KeyD') keys.right = true;
    if (e.code === 'KeyR') { ammo.mag = 30; }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') keys.fwd = false;
    if (e.code === 'KeyS') keys.back = false;
    if (e.code === 'KeyA') keys.left = false;
    if (e.code === 'KeyD') keys.right = false;
  });

  const velocity = new THREE.Vector3();
  const inputDir = new THREE.Vector3();
  const DAMPING = 9;
  const ACCEL = 60;
  const MAX_SPEED = 7.2;

  // Weapon viewmodel + muzzle flash light
  const gunGroup = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.6, roughness: 0.4 }));
  gunBody.position.set(0.28, -0.28, -0.6);
  gunGroup.add(gunBody);
  camera.add(gunGroup);
  scene.add(camera);
  const muzzleLight = new THREE.PointLight(0xffcc66, 0, 8, 0);
  muzzleLight.position.set(0.28, -0.24, -0.95);
  camera.add(muzzleLight);

  // Bots
  const bots: Bot[] = [];
  function spawnBot(x: number, z: number) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 4, 8), bodyMat);
    body.position.y = 0.9;
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), new THREE.MeshStandardMaterial({ color: 0xfca5a5 }));
    head.position.y = 1.75;
    head.castShadow = true;
    group.add(head);
    group.position.set(x, 0, z);
    scene.add(group);
    bots.push({
      mesh: group,
      head,
      hp: 100,
      alive: true,
      state: 'patrol',
      patrolTarget: new THREE.Vector3(x + (Math.random() - 0.5) * 8, 0, z + (Math.random() - 0.5) * 8),
      lastShot: 0,
    });
  }
  spawnBot(-10, -10);
  spawnBot(10, -10);
  spawnBot(0, -16);
  spawnBot(-6, 4);

  let wave = 1;
  let score = 0;
  const ammo = { mag: 30, reserve: 120 };
  let playerHp = 100;
  let audioCtx: AudioContext | null = null;
  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    return audioCtx;
  }

  const raycaster = new THREE.Raycaster();
  function shoot() {
    if (!controls.isLocked || ammo.mag <= 0) return;
    ammo.mag--;
    muzzleLight.intensity = 6;
    playTone(ensureAudio(), 140, 60, 'sawtooth', 0.16);
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const targets = bots.filter((b) => b.alive).map((b) => b.head);
    const hits = raycaster.intersectObjects(targets);
    if (hits.length > 0) {
      const hitHead = hits[0].object as THREE.Mesh;
      const bot = bots.find((b) => b.head === hitHead);
      if (bot) {
        bot.hp -= 50;
        (bot.head.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xff0000);
        setTimeout(() => (bot.head.material as THREE.MeshStandardMaterial).emissive?.set(0x000000), 90);
        if (bot.hp <= 0) {
          bot.alive = false;
          bot.mesh.visible = false;
          score += 100;
          if (bots.every((b) => !b.alive)) {
            wave++;
            score += 250;
            setTimeout(() => {
              for (const b of bots) { b.alive = true; b.hp = 100; b.mesh.visible = true; b.mesh.position.set((Math.random() - 0.5) * 24, 0, (Math.random() - 0.5) * 24 - 6); }
            }, 1200);
          }
        }
      }
    }
  }
  container.addEventListener('mousedown', (e) => { if (e.button === 0) shoot(); });

  const botRay = new THREE.Raycaster();
  function updateBots(delta: number, playerPos: THREE.Vector3, now: number) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const toPlayer = new THREE.Vector3().subVectors(playerPos, bot.mesh.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();

      botRay.set(bot.mesh.position.clone().setY(1.2), toPlayer.clone().normalize());
      const blocked = botRay.intersectObjects(pillars).length > 0 && botRay.intersectObjects(pillars)[0].distance < dist;
      const canSee = dist < 16 && !blocked;

      if (canSee) bot.state = dist < 9 ? 'attack' : 'chase';
      else if (bot.state !== 'patrol') bot.state = 'patrol';

      if (bot.state === 'patrol') {
        const toTarget = new THREE.Vector3().subVectors(bot.patrolTarget, bot.mesh.position);
        if (toTarget.length() < 0.5) bot.patrolTarget.set(bot.mesh.position.x + (Math.random() - 0.5) * 10, 0, bot.mesh.position.z + (Math.random() - 0.5) * 10);
        else bot.mesh.position.addScaledVector(toTarget.normalize(), delta * 1.4);
      } else if (bot.state === 'chase') {
        bot.mesh.position.addScaledVector(toPlayer.normalize(), delta * 2.6);
        bot.mesh.lookAt(playerPos.x, bot.mesh.position.y, playerPos.z);
      } else if (bot.state === 'attack') {
        bot.mesh.lookAt(playerPos.x, bot.mesh.position.y, playerPos.z);
        if (now - bot.lastShot > 900) {
          bot.lastShot = now;
          if (Math.random() < 0.55) playerHp = Math.max(0, playerHp - 8);
          playTone(ensureAudio(), 90, 50, 'square', 0.08);
        }
      }
      bot.mesh.position.x = THREE.MathUtils.clamp(bot.mesh.position.x, -ARENA_HALF + 1, ARENA_HALF - 1);
      bot.mesh.position.z = THREE.MathUtils.clamp(bot.mesh.position.z, -ARENA_HALF + 1, ARENA_HALF - 1);
    }
  }

  function getState() {
    return {
      fps: Math.round(fpsSmoothed),
      stepCount,
      playerPos: { x: controls.object.position.x, y: controls.object.position.y, z: controls.object.position.z },
      playerHp,
      ammoMag: ammo.mag,
      ammoReserve: ammo.reserve,
      wave,
      score,
      botsAlive: bots.filter((b) => b.alive).length,
      lighting: 'dual tactical spotlights + shadow maps',
    };
  }
  installQAHook(getState, () => { stepCount++; return getState(); });

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

    muzzleLight.intensity *= 0.82;

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
      controls.object.position.x = THREE.MathUtils.clamp(controls.object.position.x, -ARENA_HALF + 1, ARENA_HALF - 1);
      controls.object.position.z = THREE.MathUtils.clamp(controls.object.position.z, -ARENA_HALF + 1, ARENA_HALF - 1);
      controls.object.position.y = EYE_HEIGHT;

      gunGroup.position.y = Math.sin(now * 0.012) * 0.012 * (inputDir.lengthSq() > 0 ? 1 : 0.3);
      updateBots(delta, controls.object.position, now);
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
