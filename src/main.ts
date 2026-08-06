import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { QAHook, RegisteredEntity, InputAction, Vector3D } from './qaHook';

// 1. Scene, Camera, Renderer Setup
const container = document.getElementById('canvas-container')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0f172a');

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 8, 14);
camera.lookAt(0, 1, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
scene.add(dirLight);

// Grid Helper
const gridHelper = new THREE.GridHelper(20, 20, 0x38bdf8, 0x1e293b);
gridHelper.position.y = 0.01;
scene.add(gridHelper);

// 2. Cannon Physics World
const world = new CANNON.World();
world.gravity.set(0, -9.81, 0);
world.broadphase = new CANNON.NaiveBroadphase();
(world.solver as CANNON.GSSolver).iterations = 10;

const defaultMaterial = new CANNON.Material('default');
const contactMaterial = new CANNON.ContactMaterial(
  defaultMaterial,
  defaultMaterial,
  {
    friction: 0.3,
    restitution: 0.1,
  }
);
world.addContactMaterial(contactMaterial);

// Entity registry
const registeredEntities: RegisteredEntity[] = [];

// Helper to sync Three mesh with Cannon body
function syncEntityTransforms() {
  for (const entity of registeredEntities) {
    entity.mesh.position.copy(entity.body.position as any);
    entity.mesh.quaternion.copy(entity.body.quaternion as any);
  }
}

// 3. Create Entities

// A. Ground Floor (12 x 1 x 12)
const floorGeo = new THREE.BoxGeometry(12, 1, 12);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.8,
  metalness: 0.2,
});
const floorMesh = new THREE.Mesh(floorGeo, floorMat);
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const floorShape = new CANNON.Box(new CANNON.Vec3(6, 0.5, 6));
const floorBody = new CANNON.Body({
  mass: 0,
  shape: floorShape,
  material: defaultMaterial,
});
floorBody.position.set(0, -0.5, 0);
world.addBody(floorBody);

const floorEntity: RegisteredEntity = {
  id: 'floor_1',
  name: 'FloorGround',
  type: 'floor',
  mesh: floorMesh,
  body: floorBody,
};
registeredEntities.push(floorEntity);

// B. Obstacle 1 (Box 2x2x2)
const obsGeo = new THREE.BoxGeometry(2, 2, 2);
const obsMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 });
const obsMesh = new THREE.Mesh(obsGeo, obsMat);
obsMesh.castShadow = true;
obsMesh.receiveShadow = true;
scene.add(obsMesh);

const obsShape = new CANNON.Box(new CANNON.Vec3(1, 1, 1));
const obsBody = new CANNON.Body({
  mass: 0,
  shape: obsShape,
  material: defaultMaterial,
});
obsBody.position.set(-3, 1, -2);
world.addBody(obsBody);

const obsEntity: RegisteredEntity = {
  id: 'obs_1',
  name: 'OrangeObstacle',
  type: 'obstacle',
  mesh: obsMesh,
  body: obsBody,
};
registeredEntities.push(obsEntity);

// C. Obstacle 2 (Tower 1.5x3x1.5)
const obs2Geo = new THREE.BoxGeometry(1.5, 3, 1.5);
const obs2Mat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.4 });
const obs2Mesh = new THREE.Mesh(obs2Geo, obs2Mat);
obs2Mesh.castShadow = true;
obs2Mesh.receiveShadow = true;
scene.add(obs2Mesh);

const obs2Shape = new CANNON.Box(new CANNON.Vec3(0.75, 1.5, 0.75));
const obs2Body = new CANNON.Body({
  mass: 0,
  shape: obs2Shape,
  material: defaultMaterial,
});
obs2Body.position.set(3, 1.5, -1);
world.addBody(obs2Body);

const obs2Entity: RegisteredEntity = {
  id: 'obs_2',
  name: 'PurpleTower',
  type: 'obstacle',
  mesh: obs2Mesh,
  body: obs2Body,
};
registeredEntities.push(obs2Entity);

// D. North Wall (12 x 3 x 0.5)
const wallNorthGeo = new THREE.BoxGeometry(12, 3, 0.5);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
const wallNorthMesh = new THREE.Mesh(wallNorthGeo, wallMat);
wallNorthMesh.position.set(0, 1.5, -6);
wallNorthMesh.receiveShadow = true;
scene.add(wallNorthMesh);

const wallNorthShape = new CANNON.Box(new CANNON.Vec3(6, 1.5, 0.25));
const wallNorthBody = new CANNON.Body({
  mass: 0,
  shape: wallNorthShape,
  material: defaultMaterial,
});
wallNorthBody.position.set(0, 1.5, -6);
world.addBody(wallNorthBody);

const wallNorthEntity: RegisteredEntity = {
  id: 'wall_north',
  name: 'NorthWall',
  type: 'wall',
  mesh: wallNorthMesh,
  body: wallNorthBody,
};
registeredEntities.push(wallNorthEntity);

// E. Player Cube (1 x 1 x 1)
const playerGeo = new THREE.BoxGeometry(1, 1, 1);
const playerMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  roughness: 0.2,
  metalness: 0.8,
});
const playerMesh = new THREE.Mesh(playerGeo, playerMat);
playerMesh.castShadow = true;
scene.add(playerMesh);

const playerShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
const playerBody = new CANNON.Body({
  mass: 5,
  shape: playerShape,
  material: defaultMaterial,
  fixedRotation: true,
});
playerBody.position.set(0, 1, 0);
world.addBody(playerBody);

const playerEntity: RegisteredEntity = {
  id: 'player_1',
  name: 'PlayerCube',
  type: 'player',
  mesh: playerMesh,
  body: playerBody,
};
registeredEntities.push(playerEntity);

// Initial sync
syncEntityTransforms();

// 4. Input & Control Logic
const MOVE_SPEED = 7;
const JUMP_SPEED = 6.5;
const activeKeyActions = new Set<InputAction>();

function checkIsGrounded(): boolean {
  if (playerBody.velocity.y > 1.0) {
    return false;
  }
  for (const contact of world.contacts) {
    if (contact.bi === playerBody || contact.bj === playerBody) {
      const other = contact.bi === playerBody ? contact.bj : contact.bi;
      if (other === floorBody || other === obsBody || other === obs2Body) {
        return true;
      }
    }
  }
  return playerBody.position.y <= 1.1 && playerBody.position.y >= -0.2;
}

function handleInputs(inputs: Set<InputAction>) {
  let vx = 0;
  let vz = 0;

  if (inputs.has('move_forward')) vz -= MOVE_SPEED;
  if (inputs.has('move_backward')) vz += MOVE_SPEED;
  if (inputs.has('move_left')) vx -= MOVE_SPEED;
  if (inputs.has('move_right')) vx += MOVE_SPEED;

  playerBody.velocity.x = vx;
  playerBody.velocity.z = vz;

  if (inputs.has('jump')) {
    if (checkIsGrounded()) {
      playerBody.velocity.y = JUMP_SPEED;
    }
    inputs.delete('jump'); // Single trigger per jump command
  }
}

function resetPlayerPosition(pos?: Vector3D) {
  const target = pos || { x: 0, y: 1, z: 0 };
  playerBody.position.set(target.x, target.y, target.z);
  playerBody.velocity.set(0, 0, 0);
  playerBody.angularVelocity.set(0, 0, 0);
  syncEntityTransforms();
}

// Keyboard Listeners for browser play
window.addEventListener('keydown', (e) => {
  if (e.key === 'w' || e.key === 'ArrowUp') activeKeyActions.add('move_forward');
  if (e.key === 's' || e.key === 'ArrowDown') activeKeyActions.add('move_backward');
  if (e.key === 'a' || e.key === 'ArrowLeft') activeKeyActions.add('move_left');
  if (e.key === 'd' || e.key === 'ArrowRight') activeKeyActions.add('move_right');
  if (e.key === ' ' || e.key === 'Spacebar') activeKeyActions.add('jump');
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'w' || e.key === 'ArrowUp') activeKeyActions.delete('move_forward');
  if (e.key === 's' || e.key === 'ArrowDown') activeKeyActions.delete('move_backward');
  if (e.key === 'a' || e.key === 'ArrowLeft') activeKeyActions.delete('move_left');
  if (e.key === 'd' || e.key === 'ArrowRight') activeKeyActions.delete('move_right');
});

// Physics Step Function
function stepPhysics(deltaSeconds: number) {
  world.step(1 / 60, deltaSeconds, 3);
  syncEntityTransforms();
}

// 5. Initialize & Expose window.qaHook
const qaHookInstance = new QAHook({
  scene,
  world,
  renderer,
  camera,
  playerEntity,
  entities: registeredEntities,
  stepPhysics,
  handleInput: handleInputs,
  checkGrounded: checkIsGrounded,
  resetPlayer: resetPlayerPosition,
});

window.qaHook = qaHookInstance;

// HUD update
const statePreviewEl = document.getElementById('state-preview');

// 6. Animation Loop
let lastTime = performance.now();

function animate(now: number) {
  requestAnimationFrame(animate);

  const deltaMs = now - lastTime;
  lastTime = now;

  if (!qaHookInstance.isManualMode()) {
    handleInputs(activeKeyActions);
    stepPhysics(deltaMs / 1000);
    renderer.render(scene, camera);
  }

  // Update HUD text periodically
  if (statePreviewEl) {
    const currentState = qaHookInstance.getSceneState();
    statePreviewEl.textContent = JSON.stringify(
      {
        mode: qaHookInstance.isManualMode() ? 'Manual (Headless QA)' : 'Real-time 60FPS',
        stepCount: currentState.stepCount,
        playerPos: currentState.playerState.position,
        playerVel: currentState.playerState.velocity,
        isGrounded: currentState.playerState.isGrounded,
        collidingWith: currentState.entities.find((e) => e.name === 'PlayerCube')?.collidingWith || [],
      },
      null,
      2
    );
  }
}

requestAnimationFrame(animate);

// Window resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
