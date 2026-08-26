# GameTester: Context, Classes, Functions & Terminology Reference

This document serves as the complete technical dictionary for the GameTester codebase, detailing all interfaces, classes, methods, and domain terms across the engine.

---

## 1. Core ECS Observer Interfaces (`src/qaHook.ts`)

### `Vector3D`
Represents a 3D coordinate or velocity vector in Cartesian space.
* `x: number` (X-coordinate: Left/Right)
* `y: number` (Y-coordinate: Elevation/Height)
* `z: number` (Z-coordinate: Forward/Backward)

### `Quaternion4D`
Represents a 4D spatial rotation quaternion avoiding gimbal lock.
* `x: number`, `y: number`, `z: number`, `w: number`

### `BoundingBox`
Defines an Axis-Aligned Bounding Box (AABB) in world coordinates.
* `min: Vector3D` (Minimum XYZ corner)
* `max: Vector3D` (Maximum XYZ corner)

### `EntityState`
Complete snapshot of a single interactive entity in the scene.
* `id: string` (Unique entity identifier)
* `name: string` (Human-readable name, e.g. "player", "target_dummy_1")
* `type: string` ("player", "floor", "wall", "obstacle")
* `position: Vector3D` (Position in 4-decimal precision)
* `rotation: Quaternion4D` (Rotation in 4-decimal precision)
* `velocity: Vector3D` (Linear velocity vector)
* `boundingBox: BoundingBox` (World-space AABB)
* `isColliding: boolean` (True if any active physics contact exists)
* `collidingWith: string[]` (List of entity names currently in contact)

### `PlayerState`
High-frequency telemetry specific to the user/player entity.
* `position: Vector3D` (Current coordinates)
* `velocity: Vector3D` (Current linear velocity)
* `isGrounded: boolean` (True if downward raycast/physics contact confirms floor)

### `SceneState`
Unified state payload returned by `getSceneState()` or after each `step()`.
* `timestamp: number` (Epoch timestamp in milliseconds)
* `stepCount: number` (Monotonic physics step counter)
* `entities: EntityState[]` (Array of all registered scene entities)
* `playerState: PlayerState` (Dedicated player telemetry)

### `InputAction`
Allowed discrete input tokens for synthetic control injection:
* `'move_forward'` (W key)
* `'move_backward'` (S key)
* `'move_left'` (A key)
* `'move_right'` (D key)
* `'jump'` (Spacebar jump impulse)
* `'stop'` (Clears all active inputs)

---

## 2. Core Classes & Methods

### `QAHook` (`src/qaHook.ts`)
The central coordinator exposing the headless testing surface to `window.qaHook`.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `isManualMode()` | `() => boolean` | Returns true if manual deterministic stepping is active. |
| `setManualMode(enabled)` | `(boolean) => void` | Toggles between free-running RAF and manual stepping. |
| `injectInput(action)` | `(InputAction \| InputAction[]) => void` | Injects synthetic keyboard/mouse actions into input buffer. |
| `step(deltaMs)` | `(number) => SceneState` | Advances physics by deltaMs (default 16.66ms), renders frame, returns state. |
| `getSceneState()` | `() => SceneState` | Gathers instantaneous ground-truth coordinates, velocities, and contacts. |
| `assertState(condition)` | `(fn) => AssertionResult` | Evaluates a custom predicate against scene state; returns pass/fail report. |
| `resetPlayer(pos)` | `(Vector3D?) => void` | Teleports player entity to target coordinates and resets velocity to 0. |
| `startAutonomousExplorer()` | `(target?) => void` | Initiates A* automated pathfinding to target coordinate. |
| `stopAutonomousExplorer()` | `() => void` | Cancels pathfinding and resets input buffer. |
| `destroy()` | `() => void` | Cleans up active listeners and unbinds `window.qaHook`. |

---

### `VoxelWorld` (`src/minecraft/VoxelWorld.ts`)
3D spatial grid managing chunk generation, voxel storage, raycast picking, and block mutations.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `getBlock(x, y, z)` | `(number, number, number) => number` | Returns block type ID (0=Air, 1=Grass, 2=Dirt, 3=Stone, etc.). |
| `setBlock(x, y, z, type)` | `(number, number, number, number) => void` | Sets voxel type and marks mesh chunk dirty for geometry rebuild. |
| `raycastBlock(origin, dir, maxDist)` | `(Vector3, Vector3, number) => HitResult` | Performs DDA voxel traversal to find targeted block and face normal. |
| `breakBlock(x, y, z)` | `(number, number, number) => boolean` | Destroys block, spawns 18-part debris explosion particles, plays audio. |
| `placeBlock(x, y, z, type)` | `(number, number, number, number) => boolean` | Places block at face adjacent to normal, plays placement audio. |
| `getTotalBlockCount()` | `() => number` | Returns total active non-air voxels across all loaded chunks. |
| `getBlockCountsByType()` | `() => Record<string, number>` | Returns dictionary tally of block counts by category. |

---

### `PlayerControls` (`src/minecraft/PlayerControls.ts`)
Physics-driven first-person controller combining Three.js camera rotation and Cannon-es rigid body dynamics.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `update(delta)` | `(number) => void` | Applies WASD velocity vectors, gravity, ground friction, and syncs camera. |
| `jump()` | `() => void` | Applies vertical impulse of +5.83 m/s if `isGrounded` is true. |
| `setGrounded(grounded)` | `(boolean) => void` | Updates contact state from physics collision manifold. |
| `setPosition(x, y, z)` | `(number, number, number) => void` | Direct spatial repositioning of player sphere/capsule body. |

---

### `NavMeshAgent` (`src/agent/NavMeshAgent.ts`)
A* 3D pathfinding engine navigating complex voxel terrains and obstacle fields.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `setDestination(target)` | `(Vector3D) => boolean` | Computes optimal A* path across 3D voxel graph nodes. |
| `update(deltaMs)` | `(number) => void` | Steps agent along waypoint path, injecting required steering inputs. |
| `getPath()` | `() => Vector3D[]` | Returns ordered list of 3D waypoints currently being traversed. |

---

### `HeatmapGenerator` (`src/analytics/HeatmapGenerator.ts`)
Spatial analytics engine logging position distributions to detect high-traffic and neglected zones.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `recordPosition(pos)` | `(Vector3D) => void` | Increments spatial density bin corresponding to $(x, z)$ coordinate. |
| `generateTexture()` | `() => THREE.CanvasTexture` | Creates color-mapped 2D heat texture (Blue=Low, Yellow=Mid, Red=High). |
| `toggleOverlay(scene)` | `(THREE.Scene) => boolean` | Attaches/detaches floating semi-transparent heatmap plane to world. |

---

### `FPSGame` (`src/action_fps/FPSGame.ts`)
3D action tactical environment managing weapon hitscans, enemy targets, audio synthesis, and lighting.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `fireWeapon()` | `() => HitResult` | Triggers raycast hitscan, point-light muzzle flash, 16-spark physics, sound. |
| `reload()` | `() => void` | Resets active magazine counter to 30 rounds. |
| `getGameState()` | `() => FPSState` | Returns ammo count, enemy health values, score, and position. |

---

### `ShireScene` (`src/lotr/ShireScene.ts`)
Procedural atmospheric environment rendering 120-segment parametric rolling hills and dynamic lighting.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `buildTerrain()` | `() => THREE.Mesh` | Generates procedural hill geometry with heightmap sin/cos functions. |
| `updateAtmosphere(frame)` | `(number) => void` | Animates 80 floating fireflies and modulates golden hour sun angle. |

---

## 3. Core Terminology Reference

* **ECS (Entity-Component-System)**: Software architecture decoupling identity (`Entity`), state data (`Component`), and logic (`System`).
* **`window.qaHook`**: Global JavaScript interface exposing deterministic stepping, input injection, and state assertion to external AI and automation runners.
* **Deterministic Stepping**: Freezing the browser requestAnimationFrame loop to advance the simulation in exact, fixed 16.66ms time slices.
* **Double-Blind Testing**: An evaluation protocol where neither the evaluator nor the UI knows which candidate uses which underlying architecture until votes are locked.
* **Hitscan Raycast**: Projecting an instantaneous linear vector from the camera crosshair to calculate exact polygon/mesh intersection.
* **AABB (Axis-Aligned Bounding Box)**: Minimal non-rotated box enclosing a 3D geometry, used for fast preliminary collision testing.
