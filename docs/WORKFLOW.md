# GameTester: Complete Architecture & Testing Workflow

This document details the complete end-to-end workflow of the GameTester platform, covering the Headless ECS Observer engine, multi-game environments, Playwright automation test runner, and the Double-Blind A/B Benchmark Arena.

---

## 1. System Overview & Core Architecture

GameTester solves the critical latency, accuracy, and blindness bottlenecks of existing Vision-Language Model (VLM) game QA agents by replacing slow pixel-scraping loops with a zero-latency, deterministic **Entity-Component-System (ECS) Ground-Truth Observer Hook (`window.qaHook`)**.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        GAMETESTER ARCHITECTURE                          │
└─────────────────────────────────────────────────────────────────────────┘

 1. 3D Game Environments (Three.js + Cannon-es Physics)
    ├── 3D Minecraft Voxel Sandbox (27,400+ blocks, chunks, raycasting)
    ├── 3D Tactical Action FPS (Hitscan raycast, muzzle flash, audio FX)
    └── 3D Shire LOTR Environment (120-segment terrain, dynamic lighting)
                                  │
                                  ▼
 2. Headless ECS Observer Hook (window.qaHook)
    ├── State Extraction: Precise position, velocity, contacts, bounding boxes
    ├── Deterministic Step Engine: Manual frame stepping (deltaMs=16.66ms)
    ├── Synthetic Input Injection: WASD, Jump, Mouse Look, Break/Place
    └── Invariant Assertion Engine: assertState(condition) for bug detection
                                  │
                                  ▼
 3. Automated Test Runner & Observer Agents
    ├── Playwright Chromium Headless Test Suite (scripts/test_runner.mjs)
    ├── A* NavMesh Autonomous Speedrun Agent (src/agent/NavMeshAgent.ts)
    └── Spatial Density Heatmap Analytics (src/analytics/HeatmapGenerator.ts)
                                  │
                                  ▼
 4. Double-Blind A/B Evaluation Arena (http://localhost:3100/)
    ├── Slot Shuffling: Randomizes Candidate Alpha vs Candidate Beta
    ├── Anonymized Evaluation: Unbiased user rating across 3 dimensions
    └── Benchmark Diagnostics: Instant reveal of latency, FPS & collision metrics
```

---

## 2. Step-by-Step Execution Workflows

### Workflow A: Automated Headless QA Test Suite

The automated test runner evaluates physics invariants, state serialization, and collision boundaries headlessly:

1. **Test Initialization**:
   - `scripts/test_runner.mjs` spins up an ephemeral Vite test server on an isolated port (`http://localhost:3105`).
   - Playwright launches headless Chromium with hardware-accelerated WebGL flags (`--use-gl=angle --use-angle=swiftshader`).
2. **Hook Detection & Handshake**:
   - The browser navigates to `/public/game_method2.html`.
   - Playwright awaits `window.qaHook` initialization via `waitForFunction`.
3. **Deterministic State Invariant Checks (5 Tests)**:
   - **Test 1 (Voxel State Serialization)**: Verifies 27,000+ blocks, block type breakdowns (Stone, Dirt, Grass, Wood), player coordinates, and grounded state.
   - **Test 2 (Input Injection & Friction)**: Injects `move_forward`, steps physics for 15 frames (16.66ms each), and verifies negative Z-axis displacement.
   - **Test 3 (Jump & Gravity Simulation)**: Injects `jump`, tracks upward velocity ($Y_{\text{vel}} \approx +5.83$), apex deceleration, and floor touchdown confirmation.
   - **Test 4 (Boundary / Fall Invariant Detection)**: Exercises `assertState()`, deliberately checking player bounds to catch out-of-world falling bugs.
   - **Test 5 (Interactive Voxel Mutation)**: Triggers block destruction and placement, asserting exact block count transitions ($27427 \to 27426 \to 27427$).
4. **Diagnostic Output**:
   - Emits structured JSON summary to stdout and logs.

---

### Workflow B: Interactive Double-Blind Benchmark Arena

Used by human evaluators, engineers, and LLMs to comparatively benchmark candidate architectures without bias:

1. **Launch Arena**:
   - Run `npm run dev -- --port 3100` from `projects/GameTester`.
   - Open `http://localhost:3100/` in any browser.
2. **Select Game Environment**:
   - Choose between **Minecraft Voxel Sandbox**, **Tactical Action FPS**, or **Shire LOTR Environment**.
3. **Double-Blind Slot Shuffling**:
   - The arena randomly assigns the baseline architecture and the GameTester ECS hook to **Candidate Alpha** (Left) and **Candidate Beta** (Right).
   - In-game HUDs hide all method names to preserve zero bias.
4. **Interactive Play & Star Rating**:
   - Evaluator plays both viewports and rates them on:
     - Movement & Controls (1 to 5 Stars)
     - Visuals & Lighting (1 to 5 Stars)
     - Overall Experience (1 to 5 Stars)
5. **Verdict & Benchmark Reveal**:
   - Evaluator votes for Candidate Alpha or Beta.
   - Clicking **REVEAL BENCHMARK** opens the diagnostic modal showing which candidate was secretly powered by GameTester vs Baseline, with metrics for physics rate, audio synthesis, and raycast hit detection.

---

### Workflow C: Autonomous A* Speedrun & Exploration Agent

1. **Grid Extraction**: `MinecraftQAHook.ts` scans the 3D voxel array around the player and extracts walkable nodes.
2. **A* Pathfinding**: `NavMeshAgent.ts` computes the shortest path between current position and target coordinates $(X, Y, Z)$.
3. **Input Streaming**: The agent injects directional WASD and jump pulses through `window.qaHook.injectInput()` frame-by-frame.
4. **Heatmap Telemetry**: `HeatmapGenerator.ts` records $(x, y, z)$ position histories and projects an interactive density overlay across the terrain.

---

## 3. CLI Commands Reference

| Command | Action | Output / Target |
| :--- | :--- | :--- |
| `npm test` | Runs 5-test headless Playwright test suite | Structured JSON Diagnostic Log |
| `npm run dev -- --port 3100` | Starts interactive Vite studio | `http://localhost:3100/` |
| `npm run build` | Compiles TypeScript and builds production bundles | `dist/` |
| `npm run preview` | Previews production build locally | `http://localhost:4173/` |
