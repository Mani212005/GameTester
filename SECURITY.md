# Security Policy: Headless ECS Observer Hook (`window.qaHook`)

## Overview

GameTester exposes an automated testing interface via `window.qaHook` designed strictly for local headless testing, diagnostic assert loops, and double-blind benchmarking.

## Production Dead-Code Elimination

Exposing direct world state modification and synthetic input injection in client-side production bundles introduces severe security and cheat vulnerabilities in multiplayer or user-facing games (e.g. wallhacks, position teleportation, infinite resource injection).

Therefore, all `qaHook` registrations in GameTester are gated behind build-time environment flags:

```typescript
if (import.meta.env.VITE_ENABLE_QA_HOOK === 'true' || import.meta.env.DEV) {
  (window as any).qaHook = qaHookInstance;
}
```

## Build-Time Enforcement

The automated test runner executes an explicit assertion (`Test 9: Production Dead-Code Elimination of qaHook`) during CI that compiles the production bundle and asserts that `window.qaHook` is dead-code eliminated from all emitted client JavaScript bundles.
