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

import { NavMeshAgent } from '../agent/NavMeshAgent';
import { HeatmapGenerator, TelemetryPoint } from '../analytics/HeatmapGenerator';

import { Observable } from '../qaHook';

export interface AssertionResult {
  pass: boolean;
  message: string;
  state: MinecraftSceneState;
}

export class MinecraftQAHook implements Observable {
  private scene: THREE.Scene;
  private cannonWorld: CANNON.World;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private voxelWorld: VoxelWorld;
  private controls: PlayerControls;
  private particleManager?: any;

  private manualMode: boolean = false;
  private stepCount: number = 0;
  private activeInputs: Set<MinecraftInputAction> = new Set();

  private navMeshAgent: NavMeshAgent;
  private heatmapGenerator: HeatmapGenerator;

  constructor(options: {
    scene: THREE.Scene;
    cannonWorld: CANNON.World;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    voxelWorld: VoxelWorld;
    controls: PlayerControls;
    particleManager?: any;
  }) {
    this.scene = options.scene;
    this.cannonWorld = options.cannonWorld;
    this.renderer = options.renderer;
    this.camera = options.camera;
    this.voxelWorld = options.voxelWorld;
    this.controls = options.controls;
    this.particleManager = options.particleManager;

    this.navMeshAgent = new NavMeshAgent(this);
    this.heatmapGenerator = new HeatmapGenerator(this.scene);

    // Seed initial defect telemetry clusters for double-blind QA inspection
    this.seedInitialTelemetry();
  }

  private seedInitialTelemetry(): void {
    const seedPoints = [
      { x: 5, y: 7, z: 5, severity: 0.8 },
      { x: 5.2, y: 7, z: 5.3, severity: 0.95 },
      { x: 5.1, y: 7, z: 4.8, severity: 0.75 },
      { x: -10, y: 7, z: 12, severity: 0.4 },
      { x: -10.3, y: 7, z: 12.1, severity: 0.6 },
      { x: 15, y: 7, z: -8, severity: 0.9 },
      { x: 15.1, y: 7, z: -8.2, severity: 0.85 },
      { x: 0, y: 7, z: 0, severity: 0.3 },
    ];
    for (const pt of seedPoints) {
      this.heatmapGenerator.addPoint(pt.x, pt.y, pt.z, pt.severity);
    }
  }

  public getCapabilities(): string[] {
    return ['voxels', 'spatial-graph', 'raycast', 'particles', 'audio', 'heatmap', 'navmesh'];
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

    // Apply inputs to player using exact step delta
    this.controls.updateInputs(this.activeInputs, deltaSeconds);

    // Step physics using exact step delta
    this.controls.stepPhysics(deltaSeconds);
    this.controls.updateCameraPosition();

    // Update particles in manual step mode to ensure clean disposal
    if (this.particleManager && typeof this.particleManager.update === 'function') {
      this.particleManager.update(deltaSeconds);
    }

    // Record telemetry if player is colliding
    const pos = this.controls.getPlayerState().position;
    if (this.controls.isGrounded() === false && Math.abs(this.controls.velocity.x) > 0.1) {
      this.heatmapGenerator.addPoint(pos.x, pos.y, pos.z, 0.4);
    }

    this.stepCount++;
    this.renderer.render(this.scene, this.camera);

    return this.getSceneState();
  }

  public getSceneState(): MinecraftSceneState {
    return {
      hookVersion: '1.0.0',
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

  public resetWorld(seed?: number): void {
    this.activeInputs.clear();
    this.stepCount = 0;
    this.voxelWorld.resetWorld(seed);
    this.resetPlayer({ x: 0, y: 6.0, z: 0 });
    this.controls.updateInputs(new Set());
    if (this.particleManager && typeof this.particleManager.clear === 'function') {
      this.particleManager.clear();
    }
  }

  public resetPlayer(pos?: { x: number; y: number; z: number }): void {
    const target = pos || { x: 0, y: 6.0, z: 0 };
    this.controls.position.set(target.x, target.y, target.z);
    this.controls.velocity.set(0, 0, 0);
    if ((this.controls as any).currentVel) {
      (this.controls as any).currentVel.set(0, 0, 0);
    }
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
    this.startAutonomousExplorer(target);
  }

  // ----------------------------------------------------
  // Autonomous Speedrun Agent API
  // ----------------------------------------------------
  public startAutonomousExplorer(targetPos?: { x: number; y: number; z: number }): void {
    this.navMeshAgent.start(targetPos);
  }

  public stopAutonomousExplorer(): void {
    this.navMeshAgent.stop();
  }

  // ----------------------------------------------------
  // 3D Defect Heatmap Generator API
  // ----------------------------------------------------
  public getHeatmapData(): TelemetryPoint[] {
    return this.heatmapGenerator.getHeatmapData();
  }

  public toggleHeatmap(): boolean {
    return this.heatmapGenerator.toggleVisible();
  }

  public recordDefect(x: number, y: number, z: number, severity: number = 0.5): void {
    this.heatmapGenerator.addPoint(x, y, z, severity);
  }

  public destroy(): void {
    this.activeInputs.clear();
    this.stopAutonomousExplorer();
    if (typeof window !== 'undefined' && (window as any).qaHook === this) {
      delete (window as any).qaHook;
    }
  }
}