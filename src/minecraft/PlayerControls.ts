import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { VoxelWorld } from './VoxelWorld';
import { BlockType, BLOCK_DEFINITIONS, MinecraftInputAction, PlayerVoxelState } from './types';

export class PlayerControls {
  public camera: THREE.PerspectiveCamera;
  public body: CANNON.Body;
  public voxelWorld: VoxelWorld;
  public domElement: HTMLElement;

  public moveSpeed = 6.0;
  public jumpSpeed = 6.5;
  public eyeHeight = 1.4;

  public isLocked = false;

  // Euler orientation
  public pitch = 0;
  public yaw = 0;

  // Hotbar active selection
  public selectedBlockType: BlockType = BlockType.GRASS;
  public readonly hotbarSlots: BlockType[] = [
    BlockType.GRASS,
    BlockType.DIRT,
    BlockType.STONE,
    BlockType.WOOD,
  ];

  private activeActions: Set<MinecraftInputAction> = new Set();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    camera: THREE.PerspectiveCamera,
    body: CANNON.Body,
    voxelWorld: VoxelWorld,
    domElement: HTMLElement
  ) {
    this.camera = camera;
    this.body = body;
    this.voxelWorld = voxelWorld;
    this.domElement = domElement;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Click to lock pointer
    this.domElement.addEventListener('click', () => {
      if (!this.isLocked) {
        this.domElement.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
    });

    // Mouse movement
    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;

      const movementX = e.movementX || 0;
      const movementY = e.movementY || 0;

      this.yaw -= movementX * 0.002;
      this.pitch -= movementY * 0.002;

      // Clamp pitch to avoid flipping (-89 deg to +89 deg)
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
      this.updateCameraRotation();
    });

    // Keydown / Keyup
    window.addEventListener('keydown', (e) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') this.activeActions.add('move_forward');
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') this.activeActions.add('move_backward');
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') this.activeActions.add('move_left');
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') this.activeActions.add('move_right');
      if (e.key === ' ' || e.key === 'Spacebar') this.activeActions.add('jump');

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

    // Mouse click for break / place
    window.addEventListener('mousedown', (e) => {
      if (!this.isLocked) return;
      if (e.button === 0) {
        // Left click = break block
        this.breakBlock();
      } else if (e.button === 2) {
        // Right click = place block
        e.preventDefault();
        this.placeBlock();
      }
    });

    // Prevent context menu on right click
    window.addEventListener('contextmenu', (e) => {
      if (this.isLocked) e.preventDefault();
    });
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
    return this.body.position.y <= 8.2 && this.body.velocity.y <= 1.0;
  }

  public updateInputs(customActions?: Set<MinecraftInputAction>): void {
    const actions = customActions || this.activeActions;

    // Movement relative to camera orientation
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
      this.body.velocity.x = moveVector.x;
      this.body.velocity.z = moveVector.z;
    } else {
      this.body.velocity.x = 0;
      this.body.velocity.z = 0;
    }

    if (actions.has('jump')) {
      if (this.isGrounded()) {
        this.body.velocity.y = this.jumpSpeed;
      }
      actions.delete('jump'); // single trigger
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

  public updateCameraPosition(): void {
    this.camera.position.set(
      this.body.position.x,
      this.body.position.y + this.eyeHeight,
      this.body.position.z
    );
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
    const ray = this.voxelWorld.raycastVoxel(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()));
    const selDef = BLOCK_DEFINITIONS[this.selectedBlockType];

    return {
      position: {
        x: Number(this.body.position.x.toFixed(4)),
        y: Number(this.body.position.y.toFixed(4)),
        z: Number(this.body.position.z.toFixed(4)),
      },
      velocity: {
        x: Number(this.body.velocity.x.toFixed(4)),
        y: Number(this.body.velocity.y.toFixed(4)),
        z: Number(this.body.velocity.z.toFixed(4)),
      },
      rotation: {
        yaw: Number(this.yaw.toFixed(4)),
        pitch: Number(this.pitch.toFixed(4)),
      },
      isGrounded: this.isGrounded(),
      selectedBlockType: this.selectedBlockType,
      selectedBlockName: selDef ? selDef.name : 'Unknown',
      lookingAt: {
        hit: ray.hit,
        blockPos: ray.blockPos,
        blockType: ray.blockType,
        blockName: ray.blockType !== undefined ? BLOCK_DEFINITIONS[ray.blockType]?.name : undefined,
        placePos: ray.placePos,
      },
    };
  }
}
