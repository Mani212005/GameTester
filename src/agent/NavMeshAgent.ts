import { MinecraftQAHook } from '../minecraft/MinecraftQAHook';
import { BlockType } from '../minecraft/types';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface PathNode {
  x: number;
  y: number;
  z: number;
  g: number;
  h: number;
  f: number;
  parent: PathNode | null;
}

export class NavMeshAgent {
  private hook: MinecraftQAHook | any;
  private isRunning: boolean = false;
  private currentPath: Vector3D[] = [];
  private currentWaypointIndex: number = 0;
  private intervalId: any = null;

  // Stuck Watchdog history: last 10 tick positions
  private positionHistory: Vector3D[] = [];
  private stuckCounter: number = 0;
  private dodgeCounter: number = 0;
  private currentDodgeAction: string = 'move_left';

  constructor(hook: MinecraftQAHook | any) {
    this.hook = hook;
  }

  /**
   * Helper to check if player standing at integer coordinates (x, y, z) is passable.
   * Player requires 2 vertical blocks of space (foot y, head y+1) to be AIR or WATER,
   * and the ground block (y-1) must be solid.
   */
  public isPassable(x: number, y: number, z: number): boolean {
    const getBlockFn = (bx: number, by: number, bz: number): number => {
      if (typeof this.hook.getBlock === 'function') {
        return this.hook.getBlock(bx, by, bz);
      }
      return 0; // Default Air
    };

    const footBlock = getBlockFn(x, y, z);
    const headBlock = getBlockFn(x, y + 1, z);
    const groundBlock = getBlockFn(x, y - 1, z);

    const footPassable = footBlock === BlockType.AIR || footBlock === BlockType.WATER;
    const headPassable = headBlock === BlockType.AIR || headBlock === BlockType.WATER;
    const groundSolid = groundBlock !== BlockType.AIR && groundBlock !== BlockType.WATER;

    return footPassable && headPassable && groundSolid;
  }

  /**
   * A* Search Algorithm computing shortest 3D grid path from start to target.
   */
  public findPath(start: Vector3D, target: Vector3D): Vector3D[] {
    const sx = Math.floor(start.x);
    const sy = Math.floor(start.y);
    const sz = Math.floor(start.z);

    const tx = Math.floor(target.x);
    const ty = Math.floor(target.y);
    const tz = Math.floor(target.z);

    const openList: PathNode[] = [];
    const closedSet = new Set<string>();

    const getKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

    const heuristic = (x: number, y: number, z: number) => {
      return Math.sqrt((x - tx) ** 2 + (y - ty) ** 2 + (z - tz) ** 2);
    };

    const startNode: PathNode = {
      x: sx,
      y: sy,
      z: sz,
      g: 0,
      h: heuristic(sx, sy, sz),
      f: heuristic(sx, sy, sz),
      parent: null,
    };

    openList.push(startNode);

    let bestNode: PathNode = startNode;
    let maxIterations = 3000;

    while (openList.length > 0 && maxIterations > 0) {
      maxIterations--;

      // Get node with lowest f score
      openList.sort((a, b) => a.f - b.f);
      const current = openList.shift()!;

      if (current.h < bestNode.h) {
        bestNode = current;
      }

      // Check if target reached (or within 1 block)
      if (Math.abs(current.x - tx) <= 1 && Math.abs(current.z - tz) <= 1 && Math.abs(current.y - ty) <= 1) {
        bestNode = current;
        break;
      }

      const key = getKey(current.x, current.y, current.z);
      closedSet.add(key);

      // Explore 4 orthogonal directions
      const dirs = [
        { dx: 1, dz: 0 },
        { dx: -1, dz: 0 },
        { dx: 0, dz: 1 },
        { dx: 0, dz: -1 },
        { dx: 1, dz: 1 },
        { dx: -1, dz: 1 },
        { dx: 1, dz: -1 },
        { dx: -1, dz: -1 },
      ];

      for (const dir of dirs) {
        const nx = current.x + dir.dx;
        const nz = current.z + dir.dz;

        // Check vertical variations: step up (+1), flat (0), step down (-1, -2, -3)
        const yOffsets = [0, 1, -1, -2, -3];
        for (const dy of yOffsets) {
          const ny = current.y + dy;

          const nKey = getKey(nx, ny, nz);
          if (closedSet.has(nKey)) continue;

          // Check passability
          if (!this.isPassable(nx, ny, nz)) continue;

          // If stepping up 1 block, check overhead clearance at current position
          if (dy === 1) {
            const currentHeadPlusOne = this.hook.getBlock
              ? this.hook.getBlock(current.x, current.y + 2, current.z)
              : 0;
            if (currentHeadPlusOne !== BlockType.AIR && currentHeadPlusOne !== BlockType.WATER) {
              continue;
            }
          }

          const moveCost = dir.dx !== 0 && dir.dz !== 0 ? 1.414 : 1.0;
          const gScore = current.g + moveCost + (dy > 0 ? 0.2 : 0);
          const hScore = heuristic(nx, ny, nz);

          const existingOpenNode = openList.find((n) => n.x === nx && n.y === ny && n.z === nz);
          if (existingOpenNode) {
            if (gScore < existingOpenNode.g) {
              existingOpenNode.g = gScore;
              existingOpenNode.f = gScore + existingOpenNode.h;
              existingOpenNode.parent = current;
            }
          } else {
            openList.push({
              x: nx,
              y: ny,
              z: nz,
              g: gScore,
              h: hScore,
              f: gScore + hScore,
              parent: current,
            });
          }
        }
      }
    }

    // Reconstruct path
    const path: Vector3D[] = [];
    let curr: PathNode | null = bestNode;
    while (curr) {
      path.unshift({ x: curr.x + 0.5, y: curr.y, z: curr.z + 0.5 });
      curr = curr.parent;
    }

    return path;
  }

  /**
   * Raycast step probing: checks low & high blocks in front to auto-trigger jump.
   */
  private probeStepAndJump(forwardDir: { x: number; z: number }, pos: Vector3D): void {
    const probeX = Math.floor(pos.x + forwardDir.x * 0.7);
    const probeZ = Math.floor(pos.z + forwardDir.z * 0.7);
    const lowY = Math.floor(pos.y);
    const highY = Math.floor(pos.y + 1);

    const getBlockFn = (bx: number, by: number, bz: number): number => {
      return typeof this.hook.getBlock === 'function' ? this.hook.getBlock(bx, by, bz) : 0;
    };

    const lowBlock = getBlockFn(probeX, lowY, probeZ);
    const highBlock = getBlockFn(probeX, highY, probeZ);

    const lowSolid = lowBlock !== BlockType.AIR && lowBlock !== BlockType.WATER;
    const highPassable = highBlock === BlockType.AIR || highBlock === BlockType.WATER;

    if (lowSolid && highPassable) {
      this.hook.injectInput('jump');
    }
  }

  /**
   * Stuck Watchdog: tracks position delta over 10 ticks.
   * If delta < 0.05 while moving, triggers jump + directional dodge.
   */
  private checkStuckWatchdog(pos: Vector3D): boolean {
    this.positionHistory.push({ x: pos.x, y: pos.y, z: pos.z });
    if (this.positionHistory.length > 10) {
      this.positionHistory.shift();
    }

    if (this.positionHistory.length === 10) {
      const oldest = this.positionHistory[0];
      const deltaP = Math.sqrt(
        (pos.x - oldest.x) ** 2 + (pos.y - oldest.y) ** 2 + (pos.z - oldest.z) ** 2
      );

      if (deltaP < 0.05) {
        this.stuckCounter++;
        if (this.stuckCounter >= 2) {
          // Perform stuck recovery dodge
          const dodges = ['move_left', 'move_right', 'move_backward'];
          this.currentDodgeAction = dodges[this.stuckCounter % dodges.length];
          this.dodgeCounter = 5; // Dodge for 5 ticks
          this.stuckCounter = 0;
          this.positionHistory = [];
          return true;
        }
      } else {
        this.stuckCounter = 0;
      }
    }
    return false;
  }

  /**
   * Start Autonomous Speedrun Explorer towards targetPos.
   */
  public start(targetPos?: Vector3D): void {
    if (this.isRunning) {
      this.stop();
    }

    const defaultTarget = { x: 15, y: 7, z: 15 };
    const target = targetPos || defaultTarget;

    this.hook.setManualMode(true);
    this.isRunning = true;
    this.positionHistory = [];
    this.stuckCounter = 0;
    this.dodgeCounter = 0;

    const playerState = this.hook.getPlayerState
      ? this.hook.getPlayerState()
      : this.hook.getSceneState().playerState;
    const startPos = playerState.position;

    console.log('[NavMeshAgent] Planning A* path from', startPos, 'to target', target);
    this.currentPath = this.findPath(startPos, target);
    this.currentWaypointIndex = 0;

    if (this.currentPath.length === 0) {
      console.warn('[NavMeshAgent] No valid path found to target.');
      return;
    }

    console.log(`[NavMeshAgent] Path computed with ${this.currentPath.length} waypoints.`);

    this.intervalId = setInterval(() => {
      if (!this.isRunning) return;

      const pState = this.hook.getPlayerState
        ? this.hook.getPlayerState()
        : this.hook.getSceneState().playerState;
      const pos = pState.position;

      // Handle active dodge recovery tick
      if (this.dodgeCounter > 0) {
        this.dodgeCounter--;
        this.hook.injectInput(['jump', this.currentDodgeAction as any]);
        if (typeof this.hook.step === 'function') {
          this.hook.step(16.66);
        }
        return;
      }

      if (this.currentWaypointIndex >= this.currentPath.length) {
        console.log('[NavMeshAgent] Destination objective reached!');
        this.stop();
        return;
      }

      const waypoint = this.currentPath[this.currentWaypointIndex];
      const dx = waypoint.x - pos.x;
      const dz = waypoint.z - pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 0.8) {
        this.currentWaypointIndex++;
        if (this.currentWaypointIndex >= this.currentPath.length) {
          console.log('[NavMeshAgent] Speedrun objective target reached!');
          this.stop();
          return;
        }
      }

      const nextWp = this.currentPath[this.currentWaypointIndex];
      const ndx = nextWp.x - pos.x;
      const ndz = nextWp.z - pos.z;
      const yaw = Math.atan2(ndx, ndz);

      if (typeof this.hook.setPlayerLookAt === 'function') {
        this.hook.setPlayerLookAt(yaw, 0);
      }

      const normDist = Math.sqrt(ndx * ndx + ndz * ndz) || 1;
      const forwardDir = { x: ndx / normDist, z: ndz / normDist };

      this.hook.injectInput('move_forward');
      this.probeStepAndJump(forwardDir, pos);

      // Check stuck watchdog
      this.checkStuckWatchdog(pos);

      if (typeof this.hook.step === 'function') {
        this.hook.step(16.66);
      }
    }, 16.666);
  }

  /**
   * Stop Autonomous Speedrun Explorer.
   */
  public stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.hook.injectInput('stop');
    console.log('[NavMeshAgent] Autonomous explorer stopped.');
  }
}
