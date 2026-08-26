# The Winning Path Forward: Implementation Plan & Research Roadmap

## Neuro-Symbolic Continuous Vector Control & Observer Feedback Architecture

This document defines the comprehensive, step-by-step implementation plan for executing the **Winning Path Forward** across **GameTester** and **Aideos**. It bridges LLM discrete semantic intent with continuous physics, mathematical Bézier splines, and real-time observer verification.

---

## 1. Problem Formulation & Theoretical Foundations

### 1.1 The Discrete-to-Continuous Dilemma
Large Language Models (LLMs) operate on discrete, autoregressive token distributions $P(w_t \mid w_{<t})$ over a vocabulary $\mathcal{V}$. In contrast, visual motion, kinematics, and physical interaction exist in continuous Euclidean space $\mathbb{R}^d$ governed by differential equations $\ddot{x} = f(x, \dot{x}, u)$.

Directly prompting LLMs to output raw floating-point coordinates frame-by-frame fails due to:
1. **Token Quantization Error**: Floating-point decimals are fragmented into discrete character tokens, accumulating drift.
2. **Open-Loop Generation**: The LLM outputs trajectories blind, with zero sensory feedback to detect geometric self-intersections or volume collapse.
3. **Loss of $C^1/C^2$ Geometric Continuity**: Human perception detects the slightest kink in velocity or curvature acceleration.

### 1.2 The 3-Pillar Solution Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  PILLAR 1: LLM HIGH-LEVEL SEMANTIC PLANNER                                  │
│  Emits discrete high-level intent tokens (character, gesture, narrative cues) │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Sparse Keyframe Tokens
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  PILLAR 2: GAMETESTER NEURAL SPLINE & CONTINUOUS MANIFOLD LAYER              │
│  • Parametric Bézier/Hermite spline solver enforces C¹/C² continuity in ℝ²    │
│  • Collision & boundary constraint optimization prevents self-intersections  │
│  • Headless ECS Observer (window.qaHook) evaluates visual state in 60 FPS    │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Verified Continuous Motion Trajectory
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  PILLAR 3: AIDEOS / REMOTION VECTOR ENGINE                                   │
│  • Pure TypeScript 60 FPS rendering (src/dl/characters/)                     │
│  • 100% Theme-reactive semantic color slots                                  │
│  • Dual-mode framing (Hero Full-Screen vs Anchored Panel)                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Phase-by-Phase Implementation Roadmap

### Phase 1: GameTester as the Continuous Spline Bridge
**Target Goal**: Build a standalone **Neural Spline Controller** in GameTester that converts discrete keyframe tokens into mathematically certified $C^1/C^2$ continuous trajectories with zero path tangling.

#### Step 1.1: Parametric Spline Solver (`src/spline/SplineController.ts`)
* Implement **Centripetal Catmull-Rom & Cubic Bézier interpolation** for multi-joint skeletal kinematics.
* Mathematically guarantee $C^1$ (tangential continuity) and $C^2$ (curvature continuity):
  $$B(t) = (1-t)^3 P_0 + 3(1-t)^2 t P_1 + 3(1-t) t^2 P_2 + t^3 P_3, \quad t \in [0, 1]$$
* **Non-Intersection & Volume Preservation Constraints**:
  - Enforce minimum bounding capsule distances between child limbs (`leftArm`, `rightArm`) and root (`torso`).
  - Clamp rotational angle limits ($[-180^\circ, +180^\circ]$) to prevent unnatural biological joint snapping.

#### Step 1.2: Discrete Token Translator (`src/spline/TokenTranslator.ts`)
* Accepts high-level LLM gesture prompts (e.g. `{"intent": "wave", "dur": 4.0, "intensity": "energetic"}`).
* Projects high-level intent onto canonical parametric basis curves with automatic velocity easing (`ease-out-expo`, `ease-in-out-cubic`).
* Outputs a deterministic array of continuous transforms:
  $$\mathcal{T}(t) = \{ \text{group}: (\Delta x, \Delta y, \theta, S_x, S_y) \mid t \in [0, 1] \}$$

---

### Phase 2: The Observer Feedback Loop (GameTester ➔ Aideos Bridge)
**Target Goal**: Connect GameTester's `window.qaHook` directly into Aideos pre-render validation to catch visual bugs, clipping, or duration drifts before video generation.

#### Step 2.1: Headless Pre-Flight Validator (`backend/observer/aideosObserver.ts`)
* Spins up headless Chromium before Remotion rendering starts.
* Loads the compiled `film.ts` into a virtual headless canvas.
* `window.qaHook` runs a deterministic 60 FPS dry-run across all shots:
  1. **Duration Sum Invariant**: Asserts $\sum \text{Shot Durations} = \text{Voiceover Duration} \pm 50\text{ms}$.
  2. **Bounding Box Overlap Check**: Asserts that `CharacterBeat` bounding boxes do not overlap or clip into `TextReveal` cards.
  3. **Path Inversion Detector**: Verifies vector polygon area stays strictly positive ($\text{Signed Area} > 0$) across all frames to prevent self-intersection.

#### Step 2.2: Automated Self-Correction Loop
* If `window.qaHook.assertState()` flags a boundary violation (e.g. character hand clipping out of viewport bounds at frame 45):
* GameTester emits a structured correction delta:
  ```json
  {
    "shotId": "the-hook",
    "frame": 45,
    "violation": "BOUNDS_OVERFLOW",
    "fix": { "scale": 0.85, "anchorOffset": { "x": -20, "y": 0 } }
  }
  ```
* Aideos automatically applies the delta and re-validates in under 100 milliseconds without human intervention!

---

### Phase 3: Hybrid Auto-Rigger via LiveSVG
**Target Goal**: Allow users to upload *any* static SVG icon, mascot, or architecture diagram and turn it into a 60 FPS poseable character rig automatically.

#### Step 3.1: LLM Semantic Path-Clustering (`backend/rigs/pathClusterer.ts`)
* Analyzes raw SVG DOM tree (`<svg>`, `<g>`, `<path d="...">`).
* Classifies paths into semantic limbs: `torso`, `head`, `leftArm`, `rightArm`, `legs`, `accessory`.
* Solves rotational pivot centers $(P_x, P_y)$ automatically from each group's geometric bounding centroid.

#### Step 3.2: Differentiable Vector Target Fitting (LiveSVG Inspired)
* When a user requests a custom animation for an uploaded SVG:
* An asynchronous background worker runs:
  1. Temporary sphere-packing recoloring for optical flow tracking.
  2. Generates reference target motion via Wan2.1 / SVD.
  3. Fits group affine homographies + local Bézier offsets to the reference video.
* Compiles the output into a **pure TypeScript module** (`src/dl/characters/custom_rig.ts`).
* Once compiled, the new rig renders synchronously at pure 60 FPS in Remotion with full theme reactivity!

---

## 3. Success Metrics & Verification Gate

| Metric | Target | Measurement Method |
| :--- | :--- | :--- |
| **Scrubbing Latency** | $< 16.6\text{ms}$ (60 FPS) | Remotion Player frame-rate profiler |
| **Geometric Continuity** | Certified $C^1/C^2$ | Derivative curvature delta test across keyframe boundaries |
| **Collision Violations** | 0 clipping incidents | Headless `window.qaHook` bounding-box collision test suite |
| **Duration Precision** | $\pm 50\text{ms}$ of voiceover | Audio waveform vs total shot summation invariant |
| **Theme Reactivity** | 100% vector paths | Automated test verifying all paths bind semantic tokens |

---

## 4. Immediate Execution Checklist

1. [x] **Documented Architecture**: Produced `WORKFLOW.md`, `CONTEXT.md`, and this implementation roadmap in `projects/GameTester/docs/`.
2. [ ] **Build Spline Solver**: Implement `SplineController.ts` in `projects/GameTester/src/spline/` with Catmull-Rom and Bézier continuity.
3. [ ] **Wire Observer Bridge**: Create `aideosObserver.ts` connecting `window.qaHook` to Aideos `npm run validate` pipeline.
4. [ ] **Benchmark Suite Expansion**: Add automated vector continuity and clipping tests to `scripts/test_runner.mjs`.
