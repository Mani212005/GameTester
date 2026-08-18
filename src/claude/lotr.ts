import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { installQAHook } from './shared';

export interface LOTROptions {
  container: HTMLElement;
  hudEl: HTMLElement | null;
  neutralHud: boolean;
}

function terrainHeight(x: number, z: number): number {
  let h = 0;
  h += Math.sin(x * 0.08) * Math.cos(z * 0.09) * 2.6;
  h += Math.sin(x * 0.03 + 2.0) * Math.cos(z * 0.025 + 0.5) * 3.2;
  h += Math.sin((x + z) * 0.015) * 1.1;
  return h;
}

export function bootLOTRCanonical(opts: LOTROptions) {
  const { container, hudEl } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffd699);
  scene.fog = new THREE.Fog(0xffcf94, 30, 110);

  const camera = new THREE.PerspectiveCamera(72, container.clientWidth / container.clientHeight, 0.1, 300);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffe3b8, 0x3f5a2a, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffcf8a, 1.0);
  sun.position.set(-30, 22, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0015;
  scene.add(sun);

  // Rolling hill terrain, continuous displaced plane (120 segments)
  const SIZE = 90;
  const SEG = 100;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const posAttr = geo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, terrainHeight(x, z));
  }
  geo.computeVertexNormals();
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x3f8226, roughness: 0.95 });
  const ground = new THREE.Mesh(geo, grassMat);
  ground.receiveShadow = true;
  ground.castShadow = true;
  scene.add(ground);

  function heightAt(x: number, z: number): number {
    return terrainHeight(x, z);
  }

  // A winding dirt path made of flattened low boxes following a curve.
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xa9805a, roughness: 1 });
  for (let t = -40; t <= 40; t += 1.6) {
    const px = Math.sin(t * 0.06) * 6;
    const pz = t;
    const py = heightAt(px, pz) + 0.03;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 1.8), pathMat);
    seg.position.set(px, py, pz);
    seg.receiveShadow = true;
    scene.add(seg);
  }

  // Hobbit holes: dirt mound + round door + brass knob, dug into a hillside
  function buildHobbitHole(x: number, z: number, doorColor: number) {
    const group = new THREE.Group();
    const baseY = heightAt(x, z);
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(3.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x4a7128, roughness: 1 })
    );
    mound.position.set(x, baseY, z);
    mound.castShadow = true;
    mound.receiveShadow = true;
    group.add(mound);

    const doorFrame = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.15, 0.3, 24, 1, false, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xd9c39a })
    );
    doorFrame.rotation.z = Math.PI / 2;
    doorFrame.position.set(x, baseY + 1.15, z + 3.55);
    doorFrame.castShadow = true;
    group.add(doorFrame);

    const door = new THREE.Mesh(
      new THREE.CircleGeometry(1.0, 24, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: doorColor, roughness: 0.6 })
    );
    door.rotation.y = Math.PI;
    door.position.set(x, baseY + 1.15, z + 3.5);
    group.add(door);

    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.3 }));
    knob.position.set(x + 0.6, baseY + 1.0, z + 3.58);
    group.add(knob);

    scene.add(group);
    return { x, y: baseY + 1.6, z: z + 3.6 };
  }

  const lanternSpots: THREE.Vector3[] = [];
  const holeSpecs: [number, number, number][] = [
    [-14, -6, 0xef4444], [-9, 2, 0x3b82f6], [10, -4, 0xf59e0b],
    [15, 4, 0x22c55e], [-4, 10, 0x8b5cf6], [6, 14, 0xef8354],
  ];
  for (const [hx, hz, color] of holeSpecs) {
    const p = buildHobbitHole(hx, hz, color);
    lanternSpots.push(new THREE.Vector3(p.x + (Math.random() - 0.5) * 3, p.y, p.z));
  }

  // Party Tree
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a24, roughness: 0.95 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.7, 7, 12), trunkMat);
  const treeX = 0, treeZ = -14;
  trunk.position.set(treeX, heightAt(treeX, treeZ) + 3.5, treeZ);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  scene.add(trunk);
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x3f8f3f, roughness: 0.9 });
  for (const [ox, oy, oz, r] of [[0, 7.5, 0, 5.4], [3, 8.5, 2, 3.2], [-3, 8, -2, 3.4], [1.5, 10, -1.5, 3]] as [number, number, number, number][]) {
    const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), foliageMat);
    foliage.position.set(treeX + ox, heightAt(treeX, treeZ) + oy, treeZ + oz);
    foliage.castShadow = true;
    foliage.receiveShadow = true;
    scene.add(foliage);
  }

  // Lanterns
  const lanternLights: THREE.PointLight[] = [];
  for (const spot of lanternSpots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x2b2018 }));
    pole.position.set(spot.x, spot.y + 0.6, spot.z);
    scene.add(pole);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), new THREE.MeshStandardMaterial({ color: 0xffdd88, emissive: 0xffbb44, emissiveIntensity: 1.8 }));
    glow.position.set(spot.x, spot.y + 1.25, spot.z);
    scene.add(glow);
    const light = new THREE.PointLight(0xffbb55, 40, 12, 0);
    light.position.copy(glow.position);
    scene.add(light);
    lanternLights.push(light);
  }

  // Fireflies
  const fireflyGeo = new THREE.SphereGeometry(0.05, 6, 6);
  const fireflyMat = new THREE.MeshStandardMaterial({ color: 0xccffaa, emissive: 0x99ff66, emissiveIntensity: 2.2 });
  const fireflies: { mesh: THREE.Mesh; phase: number; base: THREE.Vector3 }[] = [];
  for (let i = 0; i < 70; i++) {
    const fx = (Math.random() - 0.5) * 60;
    const fz = (Math.random() - 0.5) * 60;
    const base = new THREE.Vector3(fx, heightAt(fx, fz) + 1 + Math.random() * 2, fz);
    const mesh = new THREE.Mesh(fireflyGeo, fireflyMat);
    mesh.position.copy(base);
    scene.add(mesh);
    fireflies.push({ mesh, phase: Math.random() * Math.PI * 2, base });
  }

  // --- Player (walking camera) ---
  const EYE_HEIGHT = 1.7;
  const controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.object);
  controls.object.position.set(0, heightAt(0, 22) + EYE_HEIGHT, 22);
  container.addEventListener('click', () => controls.lock());

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

  const velocity = new THREE.Vector3();
  const inputDir = new THREE.Vector3();
  const DAMPING = 7.5;
  const ACCEL = 30;
  const MAX_SPEED = 4.6;

  function getState() {
    const pos = controls.object.position;
    return {
      fps: Math.round(fpsSmoothed),
      stepCount,
      playerPos: { x: Number(pos.x.toFixed(2)), y: Number(pos.y.toFixed(2)), z: Number(pos.z.toFixed(2)) },
      lanterns: lanternLights.length,
      fireflies: fireflies.length,
      shadowMapQuality: 'PCFSoft 2048x2048',
      lighting: 'golden-hour directional + hemisphere sky bounce',
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
      const groundY = heightAt(controls.object.position.x, controls.object.position.z) + EYE_HEIGHT;
      controls.object.position.y += (groundY - controls.object.position.y) * Math.min(1, delta * 10);
    }

    const t = now * 0.001;
    for (const f of fireflies) {
      f.mesh.position.x = f.base.x + Math.sin(t * 0.6 + f.phase) * 0.8;
      f.mesh.position.y = f.base.y + Math.sin(t * 1.3 + f.phase * 1.7) * 0.4;
      f.mesh.position.z = f.base.z + Math.cos(t * 0.5 + f.phase) * 0.8;
    }
    for (const l of lanternLights) {
      l.intensity = 34 + Math.sin(t * 4 + l.position.x) * 6;
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
