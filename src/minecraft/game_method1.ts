import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { VoxelWorld } from './VoxelWorld';
import { PlayerControls } from './PlayerControls';
import { BlockType, BLOCK_DEFINITIONS } from './types';
import { getBlockMaterials } from './textures';

// Method 1: SOTA VLM Method Engine Setup
// Constraint: Vision-Language Model paradigm with standard visual rendering and basic input handling

const container = document.getElementById('canvas-container')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#38bdf8'); // Sky blue
scene.fog = new THREE.FogExp2('#38bdf8', 0.015);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 10, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// Standard Lighting (VLM visual capture baseline)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfffbeb, 1.0);
sunLight.position.set(20, 40, 15);
scene.add(sunLight);

// Cannon Physics World
const world = new CANNON.World();
world.gravity.set(0, -18, 0);
world.broadphase = new CANNON.NaiveBroadphase();

const physicsMaterial = new CANNON.Material('minecraft');
const contactMaterial = new CANNON.ContactMaterial(physicsMaterial, physicsMaterial, {
  friction: 0.1,
  restitution: 0.0,
});
world.addContactMaterial(contactMaterial);

// Custom VoxelWorld initialization with textured materials
class VLMVoxelWorld extends VoxelWorld {
  public override rebuildWorld(): void {
    // Call super.rebuildWorld first to build physics bodies
    super.rebuildWorld();

    // Replace default instanced meshes with textured block materials
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
      // Find matching positions from internal blocks map
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

const voxelWorld = new VLMVoxelWorld(scene, world, physicsMaterial);

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
const controls = new PlayerControls(camera, playerBody, voxelWorld, renderer.domElement);

// VLM Mode indicator window global
(window as any).vlmMethodInfo = {
  method: 'Method 1: SOTA VLM (Screenshot/Vision Input)',
  paradigm: 'Pixel Frame Capture & High-level Keyboard/Mouse Commands',
  hasQAHook: false,
  fps: 60,
};

// UI Elements Update
const statePreviewEl = document.getElementById('vlm-status');
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

// Animation Loop
let lastTime = performance.now();
let frameCount = 0;
let currentFps = 60;
let fpsTimer = performance.now();

function animate(now: number) {
  requestAnimationFrame(animate);

  const deltaMs = now - lastTime;
  lastTime = now;

  frameCount++;
  if (now - fpsTimer >= 1000) {
    currentFps = frameCount;
    frameCount = 0;
    fpsTimer = now;
  }

  controls.updateInputs();
  world.step(1 / 60, Math.min(deltaMs / 1000, 0.1), 3);
  controls.updateCameraPosition();
  renderer.render(scene, camera);

  if (statePreviewEl) {
    const playerPos = playerBody.position;
    statePreviewEl.textContent = `VLM Method 1 (SOTA Vision Paradigm)
Mode: Screenshot Frame Output
FPS: ${currentFps}
Player Pos: (${playerPos.x.toFixed(2)}, ${playerPos.y.toFixed(2)}, ${playerPos.z.toFixed(2)})
Selected Block: ${BLOCK_DEFINITIONS[controls.selectedBlockType]?.name || 'Grass'}`;
  }
}

requestAnimationFrame(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
