import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { VoxelWorld } from './VoxelWorld';
import { PlayerControls } from './PlayerControls';
import { MinecraftQAHook } from './MinecraftQAHook';
import { BlockType, BLOCK_DEFINITIONS, MinecraftSceneState } from './types';
import { getBlockMaterials } from './textures';

// ---------------------------------------------------------------------
// 1. Audio Generator (Web Audio API Synthesizer)
// ---------------------------------------------------------------------
class MinecraftAudio {
  private ctx: AudioContext | null = null;

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public playPlaceSound() {
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.08);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  }

  public playBreakSound() {
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const duration = 0.12;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(now);
  }
}

const audioSystem = new MinecraftAudio();

// ---------------------------------------------------------------------
// 2. Voxel Break Particle System
// ---------------------------------------------------------------------
interface BreakParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

class ParticleManager {
  private scene: THREE.Scene;
  private particles: BreakParticle[] = [];
  private pGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public spawnBlockDebris(pos: THREE.Vector3, colorHex: number) {
    const pMaterial = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.8,
    });

    for (let i = 0; i < 18; i++) {
      const mesh = new THREE.Mesh(this.pGeometry, pMaterial);
      mesh.castShadow = true;
      mesh.position.set(
        pos.x + (Math.random() - 0.5) * 0.8,
        pos.y + (Math.random() - 0.5) * 0.8,
        pos.z + (Math.random() - 0.5) * 0.8
      );

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 4.5,
        Math.random() * 4.0 + 2.5,
        (Math.random() - 0.5) * 4.5
      );

      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        life: 0,
        maxLife: 0.4 + Math.random() * 0.3,
      });
    }
  }

  public update(deltaSeconds: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += deltaSeconds;

      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        this.particles.splice(i, 1);
      } else {
        p.velocity.y -= 15 * deltaSeconds; // Gravity
        p.mesh.position.addScaledVector(p.velocity, deltaSeconds);
        const scale = 1 - p.life / p.maxLife;
        p.mesh.scale.set(scale, scale, scale);
      }
    }
  }
}

// ---------------------------------------------------------------------
// 3. Inertia & Fluid Movement PlayerControls Subclass
// ---------------------------------------------------------------------
class Method2PlayerControls extends PlayerControls {
  public particleManager!: ParticleManager;

  // Fluid Acceleration & Deceleration Inertia parameters
  private currentVel = new THREE.Vector3(0, 0, 0);
  private accelGrounded = 32.0;
  private accelAir = 12.0;
  private frictionGrounded = 18.0;
  private frictionAir = 2.0;

  public override updateInputs(customActions?: Set<any>): void {
    const actions = customActions || (this as any).activeActions;

    // Camera relative vectors
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    right.y = 0;
    right.normalize();

    const targetMove = new THREE.Vector3(0, 0, 0);

    if (actions.has('move_forward')) targetMove.add(forward);
    if (actions.has('move_backward')) targetMove.sub(forward);
    if (actions.has('move_left')) targetMove.sub(right);
    if (actions.has('move_right')) targetMove.add(right);

    const isGrounded = this.isGrounded();
    const accelRate = isGrounded ? this.accelGrounded : this.accelAir;
    const frictionRate = isGrounded ? this.frictionGrounded : this.frictionAir;

    // Delta time step (1/60s normalized)
    const dt = 1 / 60;

    if (targetMove.lengthSq() > 0) {
      targetMove.normalize().multiplyScalar(this.moveSpeed);
      // Smooth lerp velocity acceleration
      this.currentVel.x += (targetMove.x - this.currentVel.x) * Math.min(1, accelRate * dt);
      this.currentVel.z += (targetMove.z - this.currentVel.z) * Math.min(1, accelRate * dt);
    } else {
      // Fluid friction deceleration inertia
      this.currentVel.x -= this.currentVel.x * Math.min(1, frictionRate * dt);
      this.currentVel.z -= this.currentVel.z * Math.min(1, frictionRate * dt);
    }

    this.body.velocity.x = this.currentVel.x;
    this.body.velocity.z = this.currentVel.z;

    if (actions.has('jump')) {
      if (isGrounded) {
        this.body.velocity.y = this.jumpSpeed;
        audioSystem.playPlaceSound();
      }
      actions.delete('jump');
    }

    if (actions.has('select_slot_1')) this.selectedBlockType = this.hotbarSlots[0];
    if (actions.has('select_slot_2')) this.selectedBlockType = this.hotbarSlots[1];
    if (actions.has('select_slot_3')) this.selectedBlockType = this.hotbarSlots[2];
    if (actions.has('select_slot_4')) this.selectedBlockType = this.hotbarSlots[3];

    if (actions.has('break_block')) {
      this.breakBlock();
      actions.delete('break_block');
    }

    if (actions.has('place_block')) {
      this.placeBlock();
      actions.delete('place_block');
    }
  }

  public override breakBlock(): boolean {
    const ray = this.voxelWorld.raycastVoxel(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()));
    if (ray.hit && ray.blockPos) {
      const type = this.voxelWorld.getBlock(ray.blockPos.x, ray.blockPos.y, ray.blockPos.z);
      const def = BLOCK_DEFINITIONS[type];
      const color = def ? def.color : 0x22c55e;

      audioSystem.playBreakSound();
      if (this.particleManager) {
        this.particleManager.spawnBlockDebris(
          new THREE.Vector3(ray.blockPos.x + 0.5, ray.blockPos.y + 0.5, ray.blockPos.z + 0.5),
          color
        );
      }
      return this.voxelWorld.setBlock(ray.blockPos.x, ray.blockPos.y, ray.blockPos.z, BlockType.AIR);
    }
    return false;
  }

  public override placeBlock(type?: BlockType): boolean {
    const success = super.placeBlock(type);
    if (success) {
      audioSystem.playPlaceSound();
    }
    return success;
  }
}

// ---------------------------------------------------------------------
// 4. Main Method 2 Scene & Engine Setup
// ---------------------------------------------------------------------
const container = document.getElementById('canvas-container')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#38bdf8');
scene.fog = new THREE.FogExp2('#38bdf8', 0.012);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// Dynamic Shadow Mapping & AO
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// Ambient Light with hemisphere gradient for natural Ambient Occlusion feel
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x15803d, 0.35);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfffbeb, 1.3);
sunLight.position.set(25, 45, 20);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 120;
const d = 30;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

// Particle Manager
const particleManager = new ParticleManager(scene);

// Cannon Physics World with High-FPS Sub-step Solver
const world = new CANNON.World();
world.gravity.set(0, -20, 0);
world.broadphase = new CANNON.NaiveBroadphase();
(world.solver as CANNON.GSSolver).iterations = 15; // High precision collision response

const physicsMaterial = new CANNON.Material('minecraft');
const contactMaterial = new CANNON.ContactMaterial(physicsMaterial, physicsMaterial, {
  friction: 0.1,
  restitution: 0.0,
});
world.addContactMaterial(contactMaterial);

// Custom VoxelWorld subclass supporting block textures & dynamic shadows
class Method2VoxelWorld extends VoxelWorld {
  public override rebuildWorld(): void {
    super.rebuildWorld();

    const typesToReplace = [
      BlockType.GRASS,
      BlockType.DIRT,
      BlockType.STONE,
      BlockType.WOOD,
      BlockType.LEAVES,
    ];

    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const dummy = new THREE.Object3D();

    for (const type of typesToReplace) {
      const positions: { x: number; y: number; z: number }[] = [];
      for (let x = this.minX; x <= this.maxX; x++) {
        for (let z = this.minZ; z <= this.maxZ; z++) {
          for (let y = this.minY; y <= this.maxY; y++) {
            if (this.getBlock(x, y, z) === type) {
              positions.push({ x, y, z });
            }
          }
        }
      }

      if (positions.length === 0) continue;

      const materials = getBlockMaterials(type);
      const instancedMesh = new THREE.InstancedMesh(boxGeometry, materials, positions.length);
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;

      positions.forEach((pos, idx) => {
        dummy.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(idx, dummy.matrix);
      });

      instancedMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(instancedMesh);
    }
  }
}

const voxelWorld = new Method2VoxelWorld(scene, world, physicsMaterial);

// Create Player physics body
const playerShape = new CANNON.Box(new CANNON.Vec3(0.35, 0.85, 0.35));
const playerBody = new CANNON.Body({
  mass: 60,
  shape: playerShape,
  material: physicsMaterial,
  fixedRotation: true,
});
playerBody.position.set(0, 10, 0);
world.addBody(playerBody);

// Player Controls
const controls = new Method2PlayerControls(camera, playerBody, voxelWorld, renderer.domElement);
controls.particleManager = particleManager;

// ---------------------------------------------------------------------
// 5. Raycasting Target Outline Highlight Mesh
// ---------------------------------------------------------------------
const outlineBoxGeo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
const outlineEdges = new THREE.EdgesGeometry(outlineBoxGeo);
const outlineMat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 3 });
const raycastHighlight = new THREE.LineSegments(outlineEdges, outlineMat);
raycastHighlight.visible = false;
scene.add(raycastHighlight);

// ---------------------------------------------------------------------
// 6. Deep window.qaHook Observer & Assertion Architecture
// ---------------------------------------------------------------------
const qaHookInstance = new MinecraftQAHook({
  scene,
  cannonWorld: world,
  renderer,
  camera,
  voxelWorld,
  controls,
});

// Extend qaHookInstance with Method 2 diagnostic metrics
(qaHookInstance as any).getPhysicsMetrics = () => {
  return {
    solverIterations: (world.solver as CANNON.GSSolver).iterations,
    activeBodies: world.bodies.length,
    particleCount: (particleManager as any).particles.length,
    shadowMapEnabled: renderer.shadowMap.enabled,
    fps: currentFps,
  };
};

(window as any).qaHook = qaHookInstance;

// UI Hotbar & State Preview Updates
const statePreviewEl = document.getElementById('state-preview');
const hotbarEl = document.getElementById('hotbar');

function updateHotbarUI() {
  if (!hotbarEl) return;
  const currentSlot = controls.selectedBlockType;
  hotbarEl.innerHTML = controls.hotbarSlots
    .map((type, idx) => {
      const def = BLOCK_DEFINITIONS[type];
      const isSelected = type === currentSlot;
      const hexColor = '#' + def.color.toString(16).padStart(6, '0');
      return `
        <div class="hotbar-slot ${isSelected ? 'active' : ''}">
          <span class="slot-num">${idx + 1}</span>
          <div class="block-icon" style="background-color: ${hexColor};"></div>
          <span class="slot-name">${def.name}</span>
        </div>
      `;
    })
    .join('');
}

updateHotbarUI();

window.addEventListener('keydown', (e) => {
  if (['1', '2', '3', '4'].includes(e.key)) {
    updateHotbarUI();
  }
});

// ---------------------------------------------------------------------
// 7. Main Animation Loop with 60FPS Physics & Particle Updates
// ---------------------------------------------------------------------
let lastTime = performance.now();
let frameCount = 0;
let currentFps = 60;
let fpsTimer = performance.now();

function animate(now: number) {
  requestAnimationFrame(animate);

  const deltaMs = now - lastTime;
  const deltaSec = Math.min(deltaMs / 1000, 0.1);
  lastTime = now;

  frameCount++;
  if (now - fpsTimer >= 1000) {
    currentFps = frameCount;
    frameCount = 0;
    fpsTimer = now;
  }

  // Raycasting outline update
  const ray = voxelWorld.raycastVoxel(camera.position, camera.getWorldDirection(new THREE.Vector3()));
  if (ray.hit && ray.blockPos) {
    raycastHighlight.position.set(ray.blockPos.x + 0.5, ray.blockPos.y + 0.5, ray.blockPos.z + 0.5);
    raycastHighlight.visible = true;
  } else {
    raycastHighlight.visible = false;
  }

  // Update particles
  particleManager.update(deltaSec);

  if (!qaHookInstance.isManualMode()) {
    controls.updateInputs();
    world.step(1 / 60, deltaSec, 4); // 4 physics sub-steps for crisp high-FPS collision
    controls.updateCameraPosition();
    renderer.render(scene, camera);
  }

  // Live Observer Preview HUD
  if (statePreviewEl) {
    const state: MinecraftSceneState = qaHookInstance.getSceneState();
    const player = state.playerState;
    const metrics = (qaHookInstance as any).getPhysicsMetrics();

    statePreviewEl.textContent = JSON.stringify(
      {
        fps: metrics.fps,
        stepCount: state.stepCount,
        playerPos: player.position,
        playerVel: player.velocity,
        isGrounded: player.isGrounded,
        targetedBlock: player.lookingAt.hit ? player.lookingAt.blockName : 'Air',
        activeParticles: metrics.particleCount,
        shadowMapQuality: 'PCFSoft 2048x2048',
        physicsSolverIter: metrics.solverIterations,
      },
      null,
      2
    );
  }
}

requestAnimationFrame(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
