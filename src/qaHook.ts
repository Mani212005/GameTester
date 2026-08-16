import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion4D {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface BoundingBox {
  min: Vector3D;
  max: Vector3D;
}

export interface EntityState {
  id: string;
  name: string;
  type: 'player' | 'floor' | 'wall' | 'obstacle' | string;
  position: Vector3D;
  rotation: Quaternion4D;
  velocity: Vector3D;
  boundingBox: BoundingBox;
  isColliding: boolean;
  collidingWith: string[];
}

export interface PlayerState {
  position: Vector3D;
  velocity: Vector3D;
  isGrounded: boolean;
}

export interface SceneState {
  timestamp: number;
  stepCount: number;
  entities: EntityState[];
  playerState: PlayerState;
}

export type InputAction =
  | 'move_forward'
  | 'move_backward'
  | 'move_left'
  | 'move_right'
  | 'jump'
  | 'stop';

export interface AssertionResult {
  pass: boolean;
  message: string;
  state: SceneState;
}

export interface RegisteredEntity {
  id: string;
  name: string;
  type: string;
  mesh: THREE.Mesh;
  body: CANNON.Body;
}

export interface QAHookOptions {
  scene: THREE.Scene;
  world: CANNON.World;
  renderer: THREE.WebGLRenderer;
  camera: THREE.Camera;
  playerEntity: RegisteredEntity;
  entities: RegisteredEntity[];
  stepPhysics: (deltaSeconds: number) => void;
  handleInput: (actions: Set<InputAction>) => void;
  checkGrounded: () => boolean;
  resetPlayer: (pos?: Vector3D) => void;
}

export class QAHook {
  private scene: THREE.Scene;
  private world: CANNON.World;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.Camera;
  private playerEntity: RegisteredEntity;
  private entities: RegisteredEntity[];
  private stepPhysicsFn: (deltaSeconds: number) => void;
  private handleInputFn: (actions: Set<InputAction>) => void;
  private checkGroundedFn: () => boolean;
  private resetPlayerFn: (pos?: Vector3D) => void;

  private manualMode: boolean = false;
  private stepCount: number = 0;
  private activeInputs: Set<InputAction> = new Set();

  constructor(options: QAHookOptions) {
    this.scene = options.scene;
    this.world = options.world;
    this.renderer = options.renderer;
    this.camera = options.camera;
    this.playerEntity = options.playerEntity;
    this.entities = options.entities;
    this.stepPhysicsFn = options.stepPhysics;
    this.handleInputFn = options.handleInput;
    this.checkGroundedFn = options.checkGrounded;
    this.resetPlayerFn = options.resetPlayer;
  }

  public isManualMode(): boolean {
    return this.manualMode;
  }

  public setManualMode(enabled: boolean): void {
    this.manualMode = enabled;
  }

  public injectInput(action: InputAction | InputAction[]): void {
    const actions = Array.isArray(action) ? action : [action];
    for (const act of actions) {
      if (act === 'stop') {
        this.activeInputs.clear();
      } else {
        this.activeInputs.add(act);
      }
    }
    this.handleInputFn(this.activeInputs);
  }

  public step(deltaMs: number = 16.666): SceneState {
    const deltaSeconds = deltaMs / 1000;
    this.handleInputFn(this.activeInputs);
    this.stepPhysicsFn(deltaSeconds);
    this.stepCount++;
    this.renderer.render(this.scene, this.camera);
    return this.getSceneState();
  }

  public getSceneState(): SceneState {
    // Collect active contacts from cannon world
    const contactMap = new Map<CANNON.Body, Set<string>>();
    for (const contact of this.world.contacts) {
      const bodyA = contact.bi;
      const bodyB = contact.bj;
      const entityA = this.entities.find((e) => e.body === bodyA);
      const entityB = this.entities.find((e) => e.body === bodyB);

      if (entityA && entityB) {
        if (!contactMap.has(bodyA)) contactMap.set(bodyA, new Set());
        if (!contactMap.has(bodyB)) contactMap.set(bodyB, new Set());

        contactMap.get(bodyA)!.add(entityB.name);
        contactMap.get(bodyB)!.add(entityA.name);
      }
    }

    const entityStates: EntityState[] = this.entities.map((e) => {
      const box3 = new THREE.Box3().setFromObject(e.mesh);
      const collidingWithSet = contactMap.get(e.body) || new Set();
      const collidingWith = Array.from(collidingWithSet);

      return {
        id: e.id,
        name: e.name,
        type: e.type,
        position: {
          x: Number(e.body.position.x.toFixed(4)),
          y: Number(e.body.position.y.toFixed(4)),
          z: Number(e.body.position.z.toFixed(4)),
        },
        rotation: {
          x: Number(e.body.quaternion.x.toFixed(4)),
          y: Number(e.body.quaternion.y.toFixed(4)),
          z: Number(e.body.quaternion.z.toFixed(4)),
          w: Number(e.body.quaternion.w.toFixed(4)),
        },
        velocity: {
          x: Number(e.body.velocity.x.toFixed(4)),
          y: Number(e.body.velocity.y.toFixed(4)),
          z: Number(e.body.velocity.z.toFixed(4)),
        },
        boundingBox: {
          min: {
            x: Number(box3.min.x.toFixed(4)),
            y: Number(box3.min.y.toFixed(4)),
            z: Number(box3.min.z.toFixed(4)),
          },
          max: {
            x: Number(box3.max.x.toFixed(4)),
            y: Number(box3.max.y.toFixed(4)),
            z: Number(box3.max.z.toFixed(4)),
          },
        },
        isColliding: collidingWith.length > 0,
        collidingWith,
      };
    });

    const playerPos = this.playerEntity.body.position;
    const playerVel = this.playerEntity.body.velocity;

    return {
      timestamp: Date.now(),
      stepCount: this.stepCount,
      entities: entityStates,
      playerState: {
        position: {
          x: Number(playerPos.x.toFixed(4)),
          y: Number(playerPos.y.toFixed(4)),
          z: Number(playerPos.z.toFixed(4)),
        },
        velocity: {
          x: Number(playerVel.x.toFixed(4)),
          y: Number(playerVel.y.toFixed(4)),
          z: Number(playerVel.z.toFixed(4)),
        },
        isGrounded: this.checkGroundedFn(),
      },
    };
  }

  public assertState(
    condition: (state: SceneState) => boolean | { pass: boolean; message: string }
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

  public resetPlayer(pos?: Vector3D): void {
    this.resetPlayerFn(pos);
  }

  public aiSpeedrun(target: { x: number; y: number; z: number }): void {
    console.log('[QA] Speedrun to target', target);
  }

  public startAutonomousExplorer(targetPos?: { x: number; y: number; z: number }): void {
    this.aiSpeedrun(targetPos || { x: 10, y: 0, z: 10 });
  }

  public stopAutonomousExplorer(): void {
    this.injectInput('stop');
  }

  public getHeatmapData(): Array<{ x: number; y: number; z: number; severity: number }> {
    return [];
  }

  public toggleHeatmap(): boolean {
    return false;
  }
}

declare global {
  interface Window {
    qaHook: QAHook | any;
  }
}
