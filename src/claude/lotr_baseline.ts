import * as THREE from 'three';
import type { LOTROptions } from './lotr';

/** Baseline build: static flat terrain plane, unlit blocky hobbit-hole shapes,
 * no path, no fireflies, unlit "lantern" meshes with no actual light source. */
export function bootLOTRBaseline(opts: LOTROptions) {
  const { container, hudEl } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5c98a);

  const camera = new THREE.PerspectiveCamera(72, container.clientWidth / container.clientHeight, 0.1, 300);
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({ color: 0x6a9a3f }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  function buildHobbitHoleFlat(x: number, z: number, doorColor: number) {
    const mound = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7a9a4a }));
    mound.position.set(x, 0, z);
    scene.add(mound);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2), new THREE.MeshBasicMaterial({ color: doorColor, side: THREE.DoubleSide }));
    door.position.set(x, 1.1, z + 3.15);
    scene.add(door);
  }
  for (const [hx, hz, color] of [[-14, -6, 0xef4444], [-9, 2, 0x3b82f6], [10, -4, 0xf59e0b], [15, 4, 0x22c55e], [-4, 10, 0x8b5cf6], [6, 14, 0xef8354]] as [number, number, number][]) {
    buildHobbitHoleFlat(hx, hz, color);
  }

  const treeX = 0, treeZ = -14;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.4, 7, 8), new THREE.MeshBasicMaterial({ color: 0x5b3a24 }));
  trunk.position.set(treeX, 3.5, treeZ);
  scene.add(trunk);
  const foliage = new THREE.Mesh(new THREE.SphereGeometry(5.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0x4a9a4a }));
  foliage.position.set(treeX, 8.5, treeZ);
  scene.add(foliage);

  // Unlit lantern meshes - no actual point light source, just an emissive-looking flat color.
  const lanternSpots: [number, number][] = [[-14, -2.4], [-9, 5.5], [10, -0.5], [15, 7.5], [-4, 13.5], [6, 17.5]];
  for (const [lx, lz] of lanternSpots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), new THREE.MeshBasicMaterial({ color: 0x2b2018 }));
    pole.position.set(lx, 0.6, lz);
    scene.add(pole);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffdd88 }));
    glow.position.set(lx, 1.25, lz);
    scene.add(glow);
  }

  const EYE_HEIGHT = 1.7;
  camera.position.set(0, EYE_HEIGHT, 22);
  let yaw = 0, pitch = 0, pointerLocked = false;
  container.addEventListener('click', () => container.requestPointerLock());
  document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === container; });
  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = Math.max(-1.3, Math.min(1.3, pitch));
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  });

  const keys = { fwd: false, back: false, left: false, right: false };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') keys.fwd = true;
    if (e.code === 'KeyS') keys.back = true;
    if (e.code === 'KeyA') keys.left = true;
    if (e.code === 'KeyD') keys.right = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') keys.fwd = false;
    if (e.code === 'KeyS') keys.back = false;
    if (e.code === 'KeyA') keys.left = false;
    if (e.code === 'KeyD') keys.right = false;
  });
  const SPEED = 4.4;

  function getState() {
    return {
      fps: Math.round(fpsSmoothed),
      stepCount,
      playerPos: { x: Number(camera.position.x.toFixed(2)), y: Number(camera.position.y.toFixed(2)), z: Number(camera.position.z.toFixed(2)) },
      lanterns: lanternSpots.length,
      fireflies: 0,
      lighting: 'flat ambient, no shadow maps',
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
      camera.position.x += move.x * delta;
      camera.position.z += move.z * delta;
      camera.position.y = EYE_HEIGHT;
    }

    if (hudEl) {
      const preview = hudEl.querySelector('.lotr-state-preview');
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
