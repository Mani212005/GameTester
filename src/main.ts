import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { VoxelWorld } from './minecraft/VoxelWorld';
import { PlayerControls } from './minecraft/PlayerControls';
import { MinecraftQAHook } from './minecraft/MinecraftQAHook';
import { BlockType, BLOCK_DEFINITIONS } from './minecraft/types';

// 1. Scene, Camera, Renderer Setup
const container = document.getElementById('canvas-container')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#38bdf8'); // Minecraft sky blue
scene.fog = new THREE.FogExp2('#38bdf8', 0.015);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 10, 0);

// Helper for WebGL context creation with fallback
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  renderer = new THREE.WebGLRenderer({ antialias: false });
}
renderer.setSize(window.innerWidth || 1024, window.innerHeight || 768);
renderer.setPixelRatio(1);
container.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfffbeb, 1.2);
sunLight.position.set(20, 40, 15);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 100;
const d = 25;
sunLight.shadow.camera.left = -d;
sunLight.shadow.camera.right = d;
sunLight.shadow.camera.top = d;
sunLight.shadow.camera.bottom = -d;
scene.add(sunLight);

// 2. Cannon Physics World
const world = new CANNON.World();
world.gravity.set(0, -18, 0); // Crisp Minecraft gravity
world.broadphase = new CANNON.NaiveBroadphase();
(world.solver as CANNON.GSSolver).iterations = 10;

const physicsMaterial = new CANNON.Material('minecraft');
const contactMaterial = new CANNON.ContactMaterial(
  physicsMaterial,
  physicsMaterial,
  {
    friction: 0.1,
    restitution: 0.0,
  }
);
world.addContactMaterial(contactMaterial);

// 3. Voxel World & Player Initialization
const voxelWorld = new VoxelWorld(scene);

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

// 4. Initialize window.qaHook (gated in production)
let qaHookInstance: MinecraftQAHook | null = null;
if (import.meta.env.VITE_ENABLE_QA_HOOK === 'true') {
  qaHookInstance = new MinecraftQAHook({
    scene,
    cannonWorld: world,
    renderer,
    camera,
    voxelWorld,
    controls,
  });

  (window as any).qaHook = qaHookInstance;
}

// 5. UI Elements Update
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

// Keyboard slot switch updates UI
window.addEventListener('keydown', (e) => {
  if (['1', '2', '3', '4'].includes(e.key)) {
    updateHotbarUI();
  }
});

// 6. Main Animation Loop
let lastTime = performance.now();

function animate(now: number) {
  requestAnimationFrame(animate);

  const deltaMs = now - lastTime;
  lastTime = now;

  if (!qaHookInstance || !qaHookInstance.isManualMode()) {
    controls.updateInputs();
    world.step(1 / 60, Math.min(deltaMs / 1000, 0.1), 3);
    controls.updateCameraPosition();
    renderer.render(scene, camera);
  }

  // Live HUD Preview
  if (statePreviewEl && qaHookInstance) {
    const state = qaHookInstance.getSceneState();
    const player = state.playerState;
    const targetBlockStr = player.lookingAt.hit
      ? `${player.lookingAt.blockName} @ (${player.lookingAt.blockPos?.x}, ${player.lookingAt.blockPos?.y}, ${player.lookingAt.blockPos?.z})`
      : 'None';

    statePreviewEl.textContent = JSON.stringify(
      {
        qaHookMode: qaHookInstance.isManualMode() ? 'Manual Step Mode (Headless QA)' : 'Live Play Mode (60 FPS)',
        stepCount: state.stepCount,
        playerPos: player.position,
        playerVel: player.velocity,
        isGrounded: player.isGrounded,
        selectedBlock: player.selectedBlockName,
        targetBlock: targetBlockStr,
        voxelCounts: state.worldState.blockCounts,
      },
      null,
      2
    );
  }
}

requestAnimationFrame(animate);

// Responsive window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
