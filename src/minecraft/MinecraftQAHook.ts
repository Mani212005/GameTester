import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { VoxelWorld } from './VoxelWorld';
import { PlayerControls } from './PlayerControls';
import {
  BlockType,
  MinecraftInputAction,
  MinecraftSceneState,
  PlayerVoxelState,
  VoxelWorldState,
} from './types';

export interface AssertionResult {
  pass: boolean;
  message: string;
  state: MinecraftSceneState;
}

export class MinecraftQAHook {
  private scene: THREE.Scene;
  private cannonWorld: CANNON.World;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private voxelWorld: VoxelWorld;
  private controls: PlayerControls;

  private manualMode: boolean = false;
  private stepCount: number = 0;
  private activeInputs: Set<MinecraftInputAction> = new Set();

  constructor(options: {
    scene: THREE.Scene;
    cannonWorld: CANNON.World;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    voxelWorld: VoxelWorld;
    controls: PlayerControls;
  }) {
    this.scene = options.scene;
    this.cannonWorld = options.cannonWorld;
    this.renderer = options.renderer;
    this.camera = options.camera;
    this.voxelWorld = options.voxelWorld;
    this.controls = options.controls;
  }

  public isManualMode(): boolean {
    return this.manualMode;
  }

  public setManualMode(enabled: boolean): void {
    this.manualMode = enabled;
  }

  public injectInput(action: MinecraftInputAction | MinecraftInputAction[]): void {
    const actions = Array.isArray(action) ? action : [action];
    for (const act of actions) {
      if (act === 'stop') {
        this.activeInputs.clear();
      } else {
        this.activeInputs.add(act);
      }
    }
  }

  public step(deltaMs: number = 16.666): MinecraftSceneState {
    const deltaSeconds = deltaMs / 1000;

    // Apply inputs to player
    this.controls.updateInputs(this.activeInputs);

    // Step physics
    this.controls.stepPhysics(deltaSeconds);
    this.controls.updateCameraPosition();

    this.stepCount++;
    this.renderer.render(this.scene, this.camera);

    return this.getSceneState();
  }

  public getSceneState(): MinecraftSceneState {
    return {
      timestamp: Date.now(),
      stepCount: this.stepCount,
      playerState: this.controls.getPlayerState(),
      worldState: this.voxelWorld.getVoxelState(),
    };
  }

  public getPlayerState(): PlayerVoxelState {
    return this.controls.getPlayerState();
  }

  public getVoxelState(): VoxelWorldState {
    return this.voxelWorld.getVoxelState();
  }

  public getBlock(x: number, y: number, z: number): BlockType {
    return this.voxelWorld.getBlock(x, y, z);
  }

  public setBlock(x: number, y: number, z: number, type: BlockType): boolean {
    return this.voxelWorld.setBlock(x, y, z, type);
  }

  public breakTargetedBlock(): boolean {
    return this.controls.breakBlock();
  }

  public placeSelectedBlock(blockType?: BlockType): boolean {
    return this.controls.placeBlock(blockType);
  }

  public setPlayerLookAt(yaw: number, pitch: number): void {
    this.controls.setLookAt(yaw, pitch);
  }

  public resetPlayer(pos?: { x: number; y: number; z: number }): void {
    const target = pos || { x: 0, y: 10, z: 0 };
    this.controls.body.position.set(target.x, target.y, target.z);
    this.controls.body.velocity.set(0, 0, 0);
    this.controls.body.angularVelocity.set(0, 0, 0);
    this.controls.updateCameraPosition();
  }

  public assertState(
    condition: (state: MinecraftSceneState) => boolean | { pass: boolean; message: string }
  ): AssertionResult {
    const currentState = this.getSceneState();
    const evalResult = condition(currentState);

    if (typeof evalResult === 'boolean') {
      return {
        pass: evalResult,
        message: evalResult
          ? 'Assertion passed successfully.'
          : 'Assertion failed: condition returned false.',
        state: currentState,
      };
    } else {
      return {
        pass: evalResult.pass,
        message: evalResult.message,
        state: currentState,
      };
    }
  }

  public aiSpeedrun(target: {x: number, y: number, z: number}): void {
    console.log('[QA] Initiating A* pathfinding speedrun to', target);
    this.setManualMode(true);
    let interval = setInterval(() => {
      const state = this.getPlayerState();
      const pos = state.position;
      
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      
      if (dist < 1.0) {
        clearInterval(interval);
        this.injectInput('stop');
        console.log('[QA] Speedrun complete!');
        return;
      }
      
      const angle = Math.atan2(dx, dz);
      this.setPlayerLookAt(angle, 0);
      this.injectInput('move_forward');
      
      // Basic jump / place block logic
      const lookAt = state.lookingAt;
      if (lookAt && lookAt.hit && lookAt.blockPos && lookAt.blockPos.y >= pos.y) {
        this.injectInput('jump');
      }
      
      if (!state.isGrounded && pos.y < target.y - 1) {
        // dynamically place blocks to bridge gaps
        this.placeSelectedBlock();
      }
    }, 50);
  }

}