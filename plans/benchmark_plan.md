# GameTester Benchmark Architecture Plan

**Project:** GameTester  
**Author:** Lead Architect & Developer  
**Status:** Architecture Specification  
**Target:** SOTA LLM Game Testing Benchmark (VLM Screenshot vs. Headless ECS Observer)

---

## 1. Executive Summary & Benchmark Hypothesis

### 1.1 Vision & Core Problem
Traditional Quality Assurance (QA) and test automation for 3D web games face a severe trade-off between **fidelity** and **performance**:
* **Visual-only SOTA methods (VLM Screenshot Loops)** capture canvas frames, pass raw images to Multimodal Large Language Models (VLMs), and inject synthetic browser input events (`MouseEvent`, `KeyboardEvent`). While visual inspection mimics human play, it suffers from heavy frame-capture overhead, high API token costs (500–2,000 tokens per step), high latency (500ms–3s per cycle), non-deterministic rendering delays, and an inability to inspect underlying internal physics/collision states directly.
* **GameTester (Headless ECS Observer via `window.qaHook`)** exposes a zero-copy state graph, structured entity-component hierarchy, and explicit stepping control (`step(deltaMs)`). It enables direct invariant assertions (e.g., collision clip detection, voxel conservation, spatial proximity) at **100x+ higher step throughput** with sub-millisecond evaluation latency and zero frame rendering requirements.

### 1.2 Benchmark Hypothesis
When benchmarked in an automated environment and evaluated via a double-blind rating interface:
1. **Throughput & Speed:** `window.qaHook` will execute step cycles at **>500 FPS** in headless mode vs. **0.5–2 FPS** for the VLM screenshot loop.
2. **Defect Detection Precision:** `window.qaHook` will achieve **100% recall** on structural, collision, and state-desync bugs (e.g., player passing through voxels, block count drift) through mathematical invariant assertions, whereas VLM visual loops will miss micro-collisions and sub-pixel clipping.
3. **Cost Efficiency:** `window.qaHook` will reduce LLM token usage by **95%+** by feeding compressed JSON state diffs rather than full-resolution screen frames.
4. **Blind Preference:** In double-blind gameplay and test-run reviews, the Captain will rate tests driven by `window.qaHook` significantly higher in reliability, speed, and actionable error telemetry.

---

## 2. Baseline 3D Minecraft Voxel Game Specification

To rigorously test both paradigms, we build a 3D Minecraft Voxel baseline in Three.js and Cannon-es under `src/minecraft/`.

### 2.1 Engine Architecture
```
                         +-----------------------------------+
                         |           Browser DOM             |
                         +-----------------------------------+
                                           |
                                           v
                         +-----------------------------------+
                         |          Minecraft Engine         |
                         |            (src/minecraft)        |
                         +-----------------------------------+
                             /             |             \
                            /              v              \
         +-------------------+    +-----------------+    +---------------------+
         |   VoxelWorld.ts   |    | PlayerControls.t|    |  PhysicsEngine.ts   |
         | - Chunk grid      |    | - WASD + Mouse  |    | - Cannon-es World   |
         | - Grass/Dirt/Stone|    | - Jump / Look   |    | - Voxel AABB Grid   |
         | - Mesh generation |    | - Break / Place |    | - Raycast targeting |
         +-------------------+    +-----------------+    +---------------------+
                                           |
                                           v
                         +-----------------------------------+
                         |         MinecraftQAHook           |
                         |          (window.qaHook)          |
                         +-----------------------------------+
```

### 2.2 Core Game Capabilities
* **Terrain Generation:** Perlin-noise / layered chunk generation creating grass surface, dirt sublayer, bedrock/stone foundation, and tree structures (wood + leaves).
* **First-Person Navigation:** `PointerLockControls` enabling WASD movement, Space bar jumping, mouse pitch/yaw rotation, and gravity/velocity physics.
* **Voxel Manipulation:**
  * **Raycast Block Selection:** Real-time crosshair targeting calculating target voxel coordinate `(x, y, z)` and neighboring face coordinate `(nx, ny, nz)`.
  * **Block Breaking (Left-Click):** Removes target voxel, updates chunk geometry mesh, updates physics colliders, increments player inventory.
  * **Block Placing (Right-Click):** Places active hotbar material (Grass, Dirt, Stone, Wood) at neighboring face coordinate, rebuilds chunk mesh and collider bounds.
* **Physics & Collisions:** AABB collider grid sync with Cannon-es ensuring player physics body slides cleanly along block walls and stands firmly on voxel tops.

---

## 3. Method 1 Adapter: SOTA VLM Screenshot Loop

Method 1 implements the traditional visual AI testing paradigm:

```
[ Game Canvas ] ---> [ HTML5 Canvas Capture (JPEG Base64) ]
                                   |
                                   v
[ VLM Prompt Engine ] <--- [ Action History & Goal Instruction ]
         |
         v (Multimodal API Call: GPT-4o / Gemini Flash Vision)
[ Action Output Parsing ] ---> [ DOM Mouse & Keyboard Event Injection ]
```

### 3.1 Component Design
1. **Canvas Frame Exporter:** Captures current WebGL viewport via `canvas.toDataURL('image/jpeg', 0.8)`.
2. **Multimodal Prompt Construction:** Encapsulates screenshot inside a structured VLM prompt:
   * *System Prompt:* "You are an automated game testing agent. Analyze the provided game screenshot. Identify active crosshair targets, obstacles, and player orientation. Choose the optimal action: `MOVE_FORWARD`, `MOVE_BACKWARD`, `STRAFE_LEFT`, `STRAFE_RIGHT`, `JUMP`, `ROTATE_CAMERA`, `BREAK_BLOCK`, or `PLACE_BLOCK`."
3. **Synthetic Input Injector:** Converts VLM text decisions into standard browser DOM events (`KeyboardEvent` for WASD/Space, `MouseEvent` for click/mouse-movement).

### 3.2 Key Bottlenecks
* Frame serialization delay (5–20ms per frame).
* Network & inference latency (500–2500ms per decision step).
* Imprecise visual estimation of exact 3D coordinates and bounding box intersections.

---

## 4. Method 2 Adapter: GameTester Headless ECS Observer (`window.qaHook`)

Method 2 implements the GameTester zero-copy state observer architecture:

```
[ Game Engine State ] ---> [ window.qaHook State Observer ]
                                         |
                                         v
[ Pure Data JSON Graph ] <--- [ Deterministic Direct Step step(deltaMs) ]
         |
         v
[ Invariant Assertion Engine ] ---> [ Instant Bug Detection / Telemetry ]
```

### 4.1 `window.qaHook` Interface Specification
```typescript
interface MinecraftQAHook {
  // Mode Management
  setManualMode(enabled: boolean): void;
  isManualMode(): boolean;

  // Direct Stepping
  step(deltaMs?: number): VoxelSceneState;

  // State Retrieval
  getSceneState(): VoxelSceneState;
  getPlayerState(): PlayerState;
  getVoxelState(): VoxelWorldState;
  getBlock(x: number, y: number, z: number): number;

  // Action & Input Injection
  injectInput(actions: InputAction | InputAction[]): void;
  breakTargetedBlock(): boolean;
  placeSelectedBlock(blockType?: number): boolean;
  setPlayerLookAt(yaw: number, pitch: number): void;
  resetPlayer(pos?: { x: number; y: number; z: number }): void;

  // Invariant Assertion Engine
  assertState(condition: (state: VoxelSceneState) => boolean | { pass: boolean; message: string }): AssertionResult;
}
```

### 4.2 Built-in Invariant Assertions
* **No-Clip Invariant:** Player AABB must never intersect solid voxel volumes ($V_{player} \cap V_{solid} = \emptyset$).
* **Voxel Conservation Invariant:** World block removals must strictly match inventory additions.
* **Gravity Invariant:** Unsupported entities above ground level must maintain downwards acceleration ($a_y = -9.81 m/s^2$).

---

## 5. Dual-Agent Iterative Optimization Loop

To demonstrate continuous automated QA and game refinement, we specify a Dual-Agent closed-loop architecture:

```
                       +-----------------------------+
                       |    Agent A (Red Team)       |
                       |    Automated Bug Finder     |
                       +-----------------------------+
                                      |
                                      v (Discovers clipping glitch / desync)
                       +-----------------------------+
                       |    Bug Telemetry & State    |
                       |    Trace Export via qaHook  |
                       +-----------------------------+
                                      |
                                      v
                       +-----------------------------+
                       |    Agent B (Blue Team)      |
                       |    Automated Code Refactoring|
                       +-----------------------------+
                                      |
                                      v (Applies physics/state patch)
                       +-----------------------------+
                       |   Automated Test Suite Re-run|
                       +-----------------------------+
```

### 5.1 Refactor Cycle Protocol (5–15 Iterations)
1. **Agent A (Red Team):** Executes stress tests (high-speed corner collisions, rapid voxel destruction beneath player, boundary jumping). Reports detailed reproduction traces.
2. **Agent B (Blue Team):** Analyzes failure traces, generates code patches for physics collision resolution or chunk mesh rebuilding, and updates `src/minecraft/` source files.
3. **Regression Validation:** `window.qaHook` re-runs test suites headlessly across 1,000 steps in < 2 seconds to confirm zero regressions.

---

## 6. Blind Evaluation Interface

To enable unbiased Captain evaluation, we design a side-by-side web dashboard:

```
+-------------------------------------------------------------------------------+
|                       GAMETESTER BENCHMARK EVALUATION DOCK                     |
+------------------------------------+------------------------------------------+
|            Window Alpha            |               Window Beta                |
|       (Randomized Assignment)      |          (Randomized Assignment)         |
|  [ Playable 3D Canvas / Agent A ]   |     [ Playable 3D Canvas / Agent B ]     |
+------------------------------------+------------------------------------------+
|  Telemetry:                        |  Telemetry:                              |
|  - Step Rate: 60 FPS / Headless 600|  - Step Rate: 1.2 FPS                    |
|  - Latency: 0.8ms                  |  - Latency: 1250ms                       |
|  - Token Cost: 0 tokens/step       |  - Token Cost: 1,200 tokens/step         |
+------------------------------------+------------------------------------------+
|                       CAPTAIN EVALUATION PANEL                                |
|  Performance Rating: [ ★★★★★ ]      Bug Detection Precision: [ ★★★★★ ]       |
|  Responsiveness:     [ ★★★★★ ]      Overall Winner Selection: (Alpha / Beta)   |
|  [ SUBMIT CAPTAIN VERDICT ]                                                   |
+-------------------------------------------------------------------------------+
```

---

## 7. Next Steps for Execution
1. Implement full `src/minecraft/` engine with Three.js, Cannon-es, voxel chunk mesh generation, first-person pointer lock controls, and block break/place mechanics.
2. Integrate `MinecraftQAHook` into `src/minecraft/MinecraftQAHook.ts` exposing `window.qaHook`.
3. Update `index.html` and `src/main.ts` to launch the playable Minecraft baseline game with full HUD controls and live `qaHook` telemetry view.
4. Verify TypeScript compilation and Vite build with `npm run build`.
