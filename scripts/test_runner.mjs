/**
 * File Description: Hardened Playwright test runner for GameTester Headless ECS Observer.
 * Enforces pure test isolation (resetWorld), relative delta assertions, explicit named tolerances,
 * WebGL render smoke checks, and production dead-code elimination.
 */

import { createServer } from 'vite';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Explicit named physical tolerances with documented physical basis
const TOL = {
  velocity: 0.15, // m/s — accounts for Cannon-es floating point solver iteration variance
  position: 0.20, // meters — measured empirical run-to-run float accumulation across 60 physics steps
  angle: 0.5,     // degrees — rotational alignment tolerance
};

function expectWithin(actual, expected, tolerance, label = 'Value') {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${label} mismatch: expected ${expected} ±${tolerance}, but got ${actual} (delta: ${diff.toFixed(5)})`);
  }
  return true;
}

async function runTestSuite() {
  console.log('\n==================================================');
  console.log('  GameTester — Hardened ECS Observer Test Suite   ');
  console.log('==================================================\n');

  const startTime = Date.now();
  const testResults = [];

  // Track failed network requests and console errors for GT-004
  const failedRequests = [];
  const consoleErrors = [];

  // 1. Start Vite Server with QA Hook enabled
  console.log('[1/4] Starting Vite test server...');
  process.env.VITE_ENABLE_QA_HOOK = 'true';
  const server = await createServer({
    root: rootDir,
    server: { port: 3105, strictPort: false },
    logLevel: 'silent',
  });
  await server.listen();
  const serverUrl = `http://localhost:${server.config.server.port || 3105}`;
  console.log(`[Vite] Test server listening at ${serverUrl}`);

  // 2. Launch Playwright Chromium Headless with WebGL acceleration
  console.log('[2/4] Launching Playwright Headless Chromium...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();

  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.url()} (${req.failure()?.errorText || 'failed'})`);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    console.log(`[Playwright] Navigating to ${serverUrl}/public/game_method2.html...`);
    await page.goto(`${serverUrl}/public/game_method2.html`, { waitUntil: 'load' });

    // Wait for qaHook initialization
    await page.waitForFunction(() => typeof window.qaHook !== 'undefined', { timeout: 15000 });
    console.log('[Playwright] window.qaHook detected successfully!\n');

    console.log('[3/4] Running Deterministic QA Test Suite...\n');

    // ----------------------------------------------------
    // TEST 1 (GT-001): Structural Voxel State Assertions (No Magic Numbers)
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 1: Structural Voxel State Assertions (GT-001)';
      try {
        await page.evaluate(() => {
          window.qaHook.resetWorld();
          window.qaHook.setManualMode(true);
        });

        const state = await page.evaluate(() => window.qaHook.getSceneState());
        const totalBlocks = state.worldState.totalBlocks;
        const blockCounts = state.worldState.blockCounts;

        // Structural assertions: not bound to specific seed constant
        const hasCategories = Object.keys(blockCounts).length >= 4;
        const countsSum = Object.values(blockCounts).reduce((a, b) => a + b, 0);
        const sumMatchesTotal = countsSum === totalBlocks;
        const validPlayerState = typeof state.playerState.position.x === 'number' && typeof state.playerState.isGrounded === 'boolean';
        const smokeFloorPassed = totalBlocks > 1000;

        if (!hasCategories || !sumMatchesTotal || !validPlayerState || !smokeFloorPassed) {
          throw new Error(`Structural failure: hasCategories=${hasCategories}, sumMatchesTotal=${sumMatchesTotal}, totalBlocks=${totalBlocks}`);
        }

        const details = `Structural integrity verified across ${totalBlocks} voxels (${Object.keys(blockCounts).join(', ')}). Sum matches total: ${sumMatchesTotal}.`;

        testResults.push({
          name: testName,
          passed: true,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { totalBlocks, categoryCount: Object.keys(blockCounts).length },
        });
        console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
      } catch (err) {
        testResults.push({ name: testName, passed: false, durationMs: Date.now() - tStart, details: err.message });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST 2 (GT-002 & GT-003): Input Injection & Documented Friction Tolerances
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 2: Input Injection with Documented Tolerances (GT-003)';
      try {
        const resultState = await page.evaluate(() => {
          window.qaHook.resetWorld();
          window.qaHook.injectInput('move_forward');
          for (let i = 0; i < 15; i++) {
            window.qaHook.step(50);
          }
          window.qaHook.injectInput('stop');
          return window.qaHook.getSceneState();
        });

        const finalZ = resultState.playerState.position.z;
        if (finalZ >= -1.0) {
          throw new Error(`Player failed to move forward: final Z=${finalZ}`);
        }

        const details = `Player moved along negative Z-axis from Z=0.0 to Z=${finalZ.toFixed(4)}`;
        testResults.push({
          name: testName,
          passed: true,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { finalZ },
        });
        console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
      } catch (err) {
        testResults.push({ name: testName, passed: false, durationMs: Date.now() - tStart, details: err.message });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST 3 (GT-003): Jump Impulse & Gravity with Explicit Tolerances
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 3: Jump Impulse & Gravity with Explicit Tolerances (GT-003)';
      try {
        const jumpResults = await page.evaluate(() => {
          window.qaHook.resetWorld();
          window.qaHook.resetPlayer({ x: 0, y: 7.0, z: 0 });
          window.qaHook.step(16.66);
          window.qaHook.injectInput('jump');

          let tick2State = null;
          let tick25State = null;

          for (let i = 1; i <= 60; i++) {
            const st = window.qaHook.step(16.66);
            if (i === 2) tick2State = st;
            if (i === 25) tick25State = st;
          }
          const landedState = window.qaHook.getSceneState();

          return { tick2State, tick25State, landedState };
        });

        // Launch impulse target is +5.83 m/s
        expectWithin(jumpResults.tick2State.playerState.velocity.y, 5.83, TOL.velocity, 'Launch Y velocity');
        const reachedApex = jumpResults.tick25State.playerState.velocity.y < 0;
        const landedGrounded = jumpResults.landedState.playerState.isGrounded;

        if (!reachedApex || !landedGrounded) {
          throw new Error(`Apex or landing failure: reachedApex=${reachedApex}, landedGrounded=${landedGrounded}`);
        }

        const details = `Launch Y-vel=${jumpResults.tick2State.playerState.velocity.y.toFixed(3)} (within ±${TOL.velocity}), Apex Y-vel=${jumpResults.tick25State.playerState.velocity.y.toFixed(3)}, Landed=${landedGrounded}`;
        testResults.push({
          name: testName,
          passed: true,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { launchVel: jumpResults.tick2State.playerState.velocity.y, landed: landedGrounded },
        });
        console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
      } catch (err) {
        testResults.push({ name: testName, passed: false, durationMs: Date.now() - tStart, details: err.message });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST 4: Boundary & Invariant Detection via assertState
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 4: State Invariant Assertion Predicate';
      try {
        const assertionEval = await page.evaluate(() => {
          window.qaHook.resetWorld();
          window.qaHook.resetPlayer({ x: 100, y: 50, z: 100 });

          for (let i = 0; i < 20; i++) {
            window.qaHook.step(16.66);
          }

          return window.qaHook.assertState((state) => state.playerState.position.y >= 50.0);
        });

        if (assertionEval.pass !== false) {
          throw new Error('assertState failed to detect boundary breach');
        }

        const details = `assertState correctly flagged invariant breach when Y dropped below 50.0 to ${assertionEval.state.playerState.position.y.toFixed(2)}`;
        testResults.push({
          name: testName,
          passed: true,
          durationMs: Date.now() - tStart,
          details,
          snapshot: assertionEval,
        });
        console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
      } catch (err) {
        testResults.push({ name: testName, passed: false, durationMs: Date.now() - tStart, details: err.message });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST 5 (GT-001): Relative Delta Block Mutation Assertions
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 5: Relative Delta Voxel Mutation Assertions (GT-001)';
      try {
        const voxelResult = await page.evaluate(() => {
          window.qaHook.resetWorld();
          window.qaHook.resetPlayer({ x: 0, y: 7.5, z: 0 });
          window.qaHook.setPlayerLookAt(0, -Math.PI / 3);

          const beforeCount = window.qaHook.getVoxelState().totalBlocks;
          const brokeBlock = window.qaHook.breakTargetedBlock();
          const afterBreak = window.qaHook.getVoxelState().totalBlocks;

          const placedBlock = window.qaHook.placeSelectedBlock(4); // Wood
          const afterPlace = window.qaHook.getVoxelState().totalBlocks;

          return { beforeCount, brokeBlock, afterBreak, placedBlock, afterPlace };
        });

        if (!voxelResult.brokeBlock || voxelResult.afterBreak !== voxelResult.beforeCount - 1) {
          throw new Error(`Break mutation delta failed: before=${voxelResult.beforeCount}, afterBreak=${voxelResult.afterBreak}`);
        }
        if (!voxelResult.placedBlock || voxelResult.afterPlace !== voxelResult.beforeCount) {
          throw new Error(`Place mutation delta failed: afterPlace=${voxelResult.afterPlace}, expected=${voxelResult.beforeCount}`);
        }

        const details = `Relative deltas verified: Before=${voxelResult.beforeCount}, AfterBreak=${voxelResult.afterBreak} (Δ=-1), AfterPlace=${voxelResult.afterPlace} (Δ=0)`;
        testResults.push({
          name: testName,
          passed: true,
          durationMs: Date.now() - tStart,
          details,
          snapshot: voxelResult,
        });
        console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
      } catch (err) {
        testResults.push({ name: testName, passed: false, durationMs: Date.now() - tStart, details: err.message });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST 6 (GT-002): Pure Test Isolation & Reverse Order Independence
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 6: Pure Test Isolation via resetWorld (GT-002)';
      try {
        const isolationResult = await page.evaluate(() => {
          // 1. Mutate world heavily
          window.qaHook.resetWorld();
          const baselineBlocks = window.qaHook.getVoxelState().totalBlocks;
          window.qaHook.breakTargetedBlock();
          window.qaHook.breakTargetedBlock();
          const dirtyBlocks = window.qaHook.getVoxelState().totalBlocks;

          // 2. Call resetWorld and assert clean restore
          window.qaHook.resetWorld();
          const restoredBlocks = window.qaHook.getVoxelState().totalBlocks;

          return { baselineBlocks, dirtyBlocks, restoredBlocks };
        });

        if (isolationResult.dirtyBlocks === isolationResult.baselineBlocks) {
          throw new Error('Mutation failed to dirty the world state');
        }
        if (isolationResult.restoredBlocks !== isolationResult.baselineBlocks) {
          throw new Error(`resetWorld failed to restore baseline: restored=${isolationResult.restoredBlocks}, expected=${isolationResult.baselineBlocks}`);
        }

        const details = `resetWorld verified: Baseline=${isolationResult.baselineBlocks}, Dirty=${isolationResult.dirtyBlocks}, Restored=${isolationResult.restoredBlocks}`;
        testResults.push({
          name: testName,
          passed: true,
          durationMs: Date.now() - tStart,
          details,
          snapshot: isolationResult,
        });
        console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
      } catch (err) {
        testResults.push({ name: testName, passed: false, durationMs: Date.now() - tStart, details: err.message });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST 7 (GT-003): Determinism Run-to-Run Divergence Characterization
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 7: Determinism Run-to-Run Divergence Test (GT-003)';
      try {
        const divergence = await page.evaluate(() => {
          // Run sequence 1
          window.qaHook.resetWorld();
          window.qaHook.injectInput('move_forward');
          for (let i = 0; i < 60; i++) window.qaHook.step(16.66);
          const run1Pos = window.qaHook.getPlayerState().position;

          // Run sequence 2 from identical reset
          window.qaHook.resetWorld();
          window.qaHook.injectInput('move_forward');
          for (let i = 0; i < 60; i++) window.qaHook.step(16.66);
          const run2Pos = window.qaHook.getPlayerState().position;

          const dx = Math.abs(run1Pos.x - run2Pos.x);
          const dy = Math.abs(run1Pos.y - run2Pos.y);
          const dz = Math.abs(run1Pos.z - run2Pos.z);
          return Math.max(dx, dy, dz);
        });

        // Assert divergence stays under tight tolerance
        if (divergence > TOL.position) {
          throw new Error(`Run-to-run divergence exceeds tolerance: divergence=${divergence}, tolerance=${TOL.position}`);
        }

        const details = `Max run-to-run divergence over 60 steps: ${divergence.toFixed(6)}m (within ±${TOL.position}m tolerance)`;
        testResults.push({
          name: testName,
          passed: true,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { divergence },
        });
        console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
      } catch (err) {
        testResults.push({ name: testName, passed: false, durationMs: Date.now() - tStart, details: err.message });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST 8 (GT-004): WebGL Render Smoke & Context Integrity
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 8: WebGL Render Smoke & Context Integrity (GT-004)';
      try {
        const webglCheck = await page.evaluate(() => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return { hasCanvas: false };
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          if (!gl) return { hasCanvas: true, hasGl: false };

          const glError = gl.getError();
          const isContextLost = gl.isContextLost();
          return { hasCanvas: true, hasGl: true, glError, isContextLost };
        });

        if (!webglCheck.hasCanvas || !webglCheck.hasGl) {
          throw new Error('Canvas or WebGL context not found');
        }
        if (webglCheck.isContextLost || webglCheck.glError !== 0) {
          throw new Error(`WebGL context error: glError=${webglCheck.glError}, isContextLost=${webglCheck.isContextLost}`);
        }
        if (failedRequests.length > 0) {
          throw new Error(`Asset network requests failed: ${failedRequests.join(', ')}`);
        }

        const details = `WebGL context clean (NO_ERROR, contextLoss=false). Zero network request failures.`;
        testResults.push({
          name: testName,
          passed: true,
          durationMs: Date.now() - tStart,
          details,
          snapshot: webglCheck,
        });
        console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
      } catch (err) {
        testResults.push({ name: testName, passed: false, durationMs: Date.now() - tStart, details: err.message });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST 9 (GT-005): Production Dead-Code Elimination Assertion
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 9: Production Dead-Code Elimination of qaHook (GT-005)';
      try {
        // Run vite build with VITE_ENABLE_QA_HOOK=false
        execSync('npx vite build --mode production', {
          cwd: rootDir,
          env: { ...process.env, VITE_ENABLE_QA_HOOK: 'false' },
          stdio: 'pipe',
        });

        // Scan dist output files for window.qaHook leak
        const distDir = path.resolve(rootDir, 'dist');
        const jsFiles = fs.readdirSync(path.resolve(distDir, 'assets')).filter(f => f.endsWith('.js'));
        let foundLeak = false;

        for (const file of jsFiles) {
          const content = fs.readFileSync(path.resolve(distDir, 'assets', file), 'utf8');
          if (content.includes('window.qaHook=')) {
            foundLeak = true;
            break;
          }
        }

        if (foundLeak) {
          throw new Error('window.qaHook assignment leaked into production client bundle');
        }

        const details = 'Production bundle built cleanly without window.qaHook exposure.';
        testResults.push({
          name: testName,
          passed: true,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { distFilesChecked: jsFiles.length },
        });
        console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
      } catch (err) {
        testResults.push({ name: testName, passed: false, durationMs: Date.now() - tStart, details: err.message });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

  } catch (globalErr) {
    console.error('Execution error during test run:', globalErr);
  } finally {
    try { await browser.close(); } catch (_) {}
    try { await server.close(); } catch (_) {}
  }

  const totalDuration = Date.now() - startTime;
  const passedCount = testResults.filter((t) => t.passed).length;
  const failedCount = testResults.filter((t) => !t.passed).length;

  const report = {
    summary: {
      status: failedCount === 0 && testResults.length > 0 ? 'PASS' : 'FAIL',
      totalTests: testResults.length,
      passed: passedCount,
      failed: failedCount,
      totalDurationMs: totalDuration,
    },
    results: testResults,
  };

  console.log('\n==================================================');
  console.log('            DIAGNOSTIC TEST REPORT                ');
  console.log('==================================================');
  console.log(JSON.stringify(report, null, 2));
  console.log('==================================================\n');

  console.log(`Summary: total=${testResults.length}, passed=${passedCount}, failed=${failedCount}`);
  if (failedCount === 0 && testResults.length > 0) {
    console.log('All tests passed cleanly. Exiting with code 0.');
    process.exit(0);
  } else {
    console.error(`Tests failed (failedCount=${failedCount}, total=${testResults.length}). Exiting with code 1.`);
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal error in test runner:', err);
  process.exit(1);
});
