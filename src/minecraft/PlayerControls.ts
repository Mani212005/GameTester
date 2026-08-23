import * as THREE from 'three';
import { VoxelWorld } from './VoxelWorld';
import { BlockType, BLOCK_DEFINITIONS, MinecraftInputAction, PlayerVoxelState } from './types';

export class PlayerControls {
  public camera: THREE.PerspectiveCamera;
  public body: any; // Used to be CANNON.Body, let's fake it
  public voxelWorld: VoxelWorld;
  public domElement: HTMLElement;

  public position = new THREE.Vector3(0, 10, 0);
  public velocity = new THREE.Vector3(0, 0, 0);

  public moveSpeed = 6.0;
  public jumpSpeed = 6.5;
  public gravity = 20;
  public friction = 0.1;
  public eyeHeight = 1.4;

  public isLocked = false;
  public pitch = 0;
  public yaw = 0;

  public selectedBlockType: BlockType = BlockType.GRASS;
  public readonly hotbarSlots: BlockType[] = [
    BlockType.GRASS,
    BlockType.DIRT,
    BlockType.STONE,
    BlockType.WOOD,
  ];

  private activeActions: Set<MinecraftInputAction> = new Set();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private grounded = false;

  constructor(camera: THREE.PerspectiveCamera, _fakeBody: any, voxelWorld: VoxelWorld, domElement: HTMLElement) {
    this.camera = camera;
    this.voxelWorld = voxelWorld;
    this.domElement = domElement;
    this.body = { position: this.position, velocity: this.velocity, angularVelocity: new THREE.Vector3() }; // Mock CANNON.Body interface
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.domElement.addEventListener('click', () => {
      if (!this.isLocked) this.domElement.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      this.yaw -= (e.movementX || 0) * 0.002;
      this.pitch -= (e.movementY || 0) * 0.002;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
      this.updateCameraRotation();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') this.activeActions.add('move_forward');
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') this.activeActions.add('move_backward');
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this.activeActions.add('move_left');
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this.activeActions.add('move_right');
      if (e.key === ' ') this.activeActions.add('jump');
      if (e.key === '1') this.selectedBlockType = this.hotbarSlots[0];
      if (e.key === '2') this.selectedBlockType = this.hotbarSlots[1];
      if (e.key === '3') this.selectedBlockType = this.hotbarSlots[2];
      if (e.key === '4') this.selectedBlockType = this.hotbarSlots[3];
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') this.activeActions.delete('move_forward');
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') this.activeActions.delete('move_backward');
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this.activeActions.delete('move_left');
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this.activeActions.delete('move_right');
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.isLocked) return;
      if (e.button === 0) this.breakBlock();
      else if (e.button === 2) { e.preventDefault(); this.placeBlock(); }
    });
    window.addEventListener('contextmenu', (e) => { if (this.isLocked) e.preventDefault(); });
  }

  public updateCameraRotation(): void {
    this.euler.x = this.pitch;
    this.euler.y = this.yaw;
    this.euler.z = 0;
    this.camera.quaternion.setFromEuler(this.euler);
  }

  public setLookAt(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
    this.updateCameraRotation();
  }

  public isGrounded(): boolean {
    return this.grounded;
  }

  // Swept-AABB custom physics resolution
  public stepPhysics(dt: number) {
    const r = 0.35;
    const h = 1.7;

    // Respawn & zero velocity if falling into void below Y = -30
    if (this.position.y < -30) {
      this.position.set(0, 10, 0);
      this.velocity.set(0, 0, 0);
      this.grounded = false;
    }

    this.velocity.y -= this.gravity * dt;
    const move = this.velocity.clone().multiplyScalar(dt);

    // Substep to prevent tunneling
    const steps = Math.ceil(move.length() / 0.1);
    const stepMove = move.divideScalar(steps);

    for (let i = 0; i < steps; i++) {
      this.position.y += stepMove.y;
      if (this.checkCollision(this.position, r, h)) {
        if (stepMove.y < 0) {
          this.position.y = Math.floor(this.position.y) + 1;
          this.grounded = true;
        } else if (stepMove.y > 0) {
          this.position.y = Math.ceil(this.position.y + h) - h - 0.001;
        }
        this.velocity.y = 0;
        stepMove.y = 0;
      } else {
        this.grounded = false;
      }

      this.position.x += stepMove.x;
      if (this.checkCollision(this.position, r, h)) {
        if (stepMove.x < 0) {
          this.position.x = Math.floor(this.position.x - r) + r + 1.001;
        } else if (stepMove.x > 0) {
          this.position.x = Math.floor(this.position.x + r) - r - 0.001;
        }
        this.velocity.x = 0;
        stepMove.x = 0;
      }

      this.position.z += stepMove.z;
      if (this.checkCollision(this.position, r, h)) {
        if (stepMove.z < 0) {
          this.position.z = Math.floor(this.position.z - r) + r + 1.001;
        } else if (stepMove.z > 0) {
          this.position.z = Math.floor(this.position.z + r) - r - 0.001;
        }
        this.velocity.z = 0;
        stepMove.z = 0;
      }
    }
  }

  private checkCollision(pos: THREE.Vector3, r: number, h: number): boolean {
    const minX = Math.floor(pos.x - r);
    const maxX = Math.floor(pos.x + r);
    const minY = Math.floor(pos.y);
    const maxY = Math.floor(pos.y + h - 0.1);
    const minZ = Math.floor(pos.z - r);
    const maxZ = Math.floor(pos.z + r);

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const type = this.voxelWorld.getBlock(x, y, z);
          if (type !== BlockType.AIR && type !== BlockType.WATER) {
            return true;
          }
        }
      }
    }
    return false;
  }

  public updateInputs(customActions?: Set<MinecraftInputAction>): void {
    const actions = customActions || this.activeActions;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    right.y = 0;
    right.normalize();

    const moveVector = new THREE.Vector3(0, 0, 0);
    if (actions.has('move_forward')) moveVector.add(forward);
    if (actions.has('move_backward')) moveVector.sub(forward);
    if (actions.has('move_left')) moveVector.sub(right);
    if (actions.has('move_right')) moveVector.add(right);

    if (moveVector.lengthSq() > 0) {
      moveVector.normalize().multiplyScalar(this.moveSpeed);
      // Interpolate horizontal velocity (simulate friction)
      this.velocity.x += (moveVector.x - this.velocity.x) * (1 - this.friction);
      this.velocity.z += (moveVector.z - this.velocity.z) * (1 - this.friction);
    } else {
      this.velocity.x *= this.friction;
      this.velocity.z *= this.friction;
    }

    if (actions.has('jump') && this.grounded) {
      this.velocity.y = this.jumpSpeed;
      this.grounded = false;
      actions.delete('jump');
    }

    if (actions.has('break_block')) { this.breakBlock(); actions.delete('break_block'); }
    if (actions.has('place_block')) { this.placeBlock(); actions.delete('place_block'); }
  }

  public updateCameraPosition(): void {
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  public breakBlock(): boolean {
    const ray = this.voxelWorld.raycastVoxel(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()));
    if (ray.hit && ray.blockPos) {
      return this.voxelWorld.setBlock(ray.blockPos.x, ray.blockPos.y, ray.blockPos.z, BlockType.AIR);
    }
    return false;
  }

  public placeBlock(type?: BlockType): boolean {
    const blockToPlace = type !== undefined ? type : this.selectedBlockType;
    const ray = this.voxelWorld.raycastVoxel(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()));
    if (ray.hit && ray.placePos) {
      return this.voxelWorld.setBlock(ray.placePos.x, ray.placePos.y, ray.placePos.z, blockToPlace);
    }
    return false;
  }

  public getPlayerState(): PlayerVoxelState {
    return {
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      rotation: { yaw: this.yaw, pitch: this.pitch },
      isGrounded: this.grounded,
      selectedBlockType: this.selectedBlockType,
      selectedBlockName: 'Block',
      lookingAt: { hit: false }
    };
  }
}
