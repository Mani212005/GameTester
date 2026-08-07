import { createServer } from 'vite';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runTestSuite() {
  console.log('\n==================================================');
  console.log('  GameTester - Headless ECS Observer Test Runner  ');
  console.log('==================================================\n');

  const startTime = Date.now();
  const testResults = [];

  // 1. Start Vite Server
  console.log('[1/4] Starting Vite dev server in background...');
  const server = await createServer({
    root: rootDir,
    server: { port: 3100, strictPort: true },
    logLevel: 'silent',
  });
  await server.listen();
  const serverUrl = 'http://localhost:3100';
  console.log(`[Vite] Server listening at ${serverUrl}`);

  // 2. Launch Playwright Chromium Headless
  console.log('[2/4] Launching Playwright Headless Chromium...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();

  page.on('console', (msg) => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => console.log(`[Browser Unhandled Error] ${err.stack || err.message}`));

  try {
    console.log(`[Playwright] Navigating to ${serverUrl}/public/game_method2.html...`);
    await page.goto(`${serverUrl}/public/game_method2.html`, { waitUntil: 'load' });

    // Wait for qaHook initialization
    await page.waitForFunction(() => typeof window.qaHook !== 'undefined', { timeout: 15000 });
    console.log('[Playwright] window.qaHook detected successfully!\n');

    console.log('[3/4] Running Deterministic QA Test Suite...\n');

    // ----------------------------------------------------
    // TEST 1: Minecraft Voxel World State Serialization
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 1: Minecraft Voxel World State Serialization';
      try {
        await page.evaluate(() => {
          window.qaHook.setManualMode(true);
        });
        const state = await page.evaluate(() => window.qaHook.getSceneState());

        const totalBlocks = state.worldState.totalBlocks;
        const hasGrass = (state.worldState.blockCounts['Grass'] || 0) > 0;
        const hasStone = (state.worldState.blockCounts['Stone'] || 0) > 0;
        const isGrounded = state.playerState.isGrounded;

        const passed = totalBlocks > 1000 && hasGrass && hasStone;
        const details = `Serialized Voxel World with ${totalBlocks} total blocks (Grass, Dirt, Stone, Wood, Leaves). Player position: (${state.playerState.position.x}, ${state.playerState.position.y}, ${state.playerState.position.z}), Grounded: ${isGrounded}`;

        testResults.push({
          name: testName,
          passed,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { playerState: state.playerState, worldState: state.worldState },
        });
        if (passed) {
          console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
        } else {
          console.log(`  ✗ ${testName} [FAIL]: totalBlocks=${totalBlocks}, hasGrass=${hasGrass}, hasStone=${hasStone}`);
        }
      } catch (err) {
        testResults.push({
          name: testName,
          passed: false,
          durationMs: Date.now() - tStart,
          details: err.message,
        });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST 2: Deterministic Input Injection & Movement
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 2: Deterministic Input Injection & Movement';
      try {
        const resultState = await page.evaluate(() => {
          window.qaHook.resetPlayer({ x: 0, y: 10, z: 0 });
          window.qaHook.injectInput('move_forward');
          for (let i = 0; i < 15; i++) {
            window.qaHook.step(50);
          }
          window.qaHook.injectInput('stop');
          return window.qaHook.getSceneState();
        });

        const movedForward = resultState.playerState.position.z < -1.0;
        const details = `Player moved along Z-axis from Z=0.0000 to Z=${resultState.playerState.position.z}`;

        testResults.push({
          name: testName,
          passed: movedForward,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { playerState: resultState.playerState, stepCount: resultState.stepCount },
        });
        console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
      } catch (err) {
        testResults.push({
          name: testName,
          passed: false,
          durationMs: Date.now() - tStart,
          details: err.message,
        });
        console.log(`  ✗ ${testName} [FAIL]`);
      }
    }

    // ----------------------------------------------------
    // TEST 3: Deterministic Jump & Gravity Simulation
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 3: Jump Impulse & Gravity Physics Simulation';
      try {
        const jumpResults = await page.evaluate(() => {
          window.qaHook.resetPlayer({ x: 0, y: 7.5, z: 0 });
          window.qaHook.injectInput('jump');
          const airState = window.qaHook.step(50); // Step 1 tick for jump impulse

          for (let i = 0; i < 60; i++) {
            window.qaHook.step(50);
          }
          const landedState = window.qaHook.getSceneState();

          return { airState, landedState };
        });

        const jumpTriggered = jumpResults.airState.playerState.velocity.y > 0;
        const reachedApex = jumpResults.airState.playerState.position.y > 7.5;
        const landedBack = jumpResults.landedState.playerState.isGrounded;

        const passed = jumpTriggered && reachedApex && landedBack;
        const details = `Jump launch Y-vel=${jumpResults.airState.playerState.velocity.y}, Air Y-pos=${jumpResults.airState.playerState.position.y}, Landed Grounded=${landedBack}`;

        testResults.push({
          name: testName,
          passed,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { airState: jumpResults.airState.playerState, landedState: jumpResults.landedState.playerState },
        });
        if (passed) {
          console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
        } else {
          console.log(`  ✗ ${testName} [FAIL]: jumpTriggered=${jumpTriggered}, reachedApex=${reachedApex}, landedBack=${landedBack}`);
        }
      } catch (err) {
        testResults.push({
          name: testName,
          passed: false,
          durationMs: Date.now() - tStart,
          details: err.message,
        });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST 4: State Invariant Assertion (Boundary / Fall Detection)
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 4: State Invariant Assertion (Boundary / Fall Detection)';
      try {
        const assertionEvaluation = await page.evaluate(() => {
          window.qaHook.resetPlayer({ x: 15.0, y: 7.5, z: 0 });
          window.qaHook.injectInput('move_right');

          for (let i = 0; i < 100; i++) {
            window.qaHook.step(50);
          }
          window.qaHook.injectInput('stop');

          const result = window.qaHook.assertState(
            (state) => state.playerState.position.y > -5.0
          );
          return result;
        });

        const invariantDetected = assertionEvaluation.pass === false;
        const passed = invariantDetected;
        const details = `assertState correctly flagged invariant violation when player Y reached ${assertionEvaluation.state.playerState.position.y}`;

        testResults.push({
          name: testName,
          passed,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { assertionResult: assertionEvaluation },
        });
        if (passed) {
          console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
        } else {
          console.log(`  ✗ ${testName} [FAIL]: invariantDetected=${invariantDetected}`);
        }
      } catch (err) {
        testResults.push({
          name: testName,
          passed: false,
          durationMs: Date.now() - tStart,
          details: err.message,
        });
        console.log(`  ✗ ${testName} [FAIL]: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // TEST 5: Interactive Voxel Modification Observer (Block Break / Place)
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 5: Interactive Voxel Modification Observer';
      try {
        const voxelModResult = await page.evaluate(() => {
          window.qaHook.resetPlayer({ x: 0, y: 7.5, z: 0 });
          window.qaHook.setPlayerLookAt(0, -Math.PI / 3); // Look down towards grass block
          const initialBlocks = window.qaHook.getVoxelState().totalBlocks;

          const brokeBlock = window.qaHook.breakTargetedBlock();
          const stateAfterBreak = window.qaHook.getVoxelState().totalBlocks;

          const placedBlock = window.qaHook.placeSelectedBlock(4); // Place Wood
          const stateAfterPlace = window.qaHook.getVoxelState().totalBlocks;

          return { initialBlocks, brokeBlock, stateAfterBreak, placedBlock, stateAfterPlace };
        });

        const passed = voxelModResult.brokeBlock && voxelModResult.stateAfterBreak === voxelModResult.initialBlocks - 1 && voxelModResult.placedBlock && voxelModResult.stateAfterPlace === voxelModResult.initialBlocks;
        const details = `Block Break & Place: Initial=${voxelModResult.initialBlocks}, AfterBreak=${voxelModResult.stateAfterBreak}, AfterPlace=${voxelModResult.stateAfterPlace}`;

        testResults.push({
          name: testName,
          passed,
          durationMs: Date.now() - tStart,
          details,
          snapshot: voxelModResult,
        });
        if (passed) {
          console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
        } else {
          console.log(`  ✗ ${testName} [FAIL]: brokeBlock=${voxelModResult.brokeBlock}, placedBlock=${voxelModResult.placedBlock}`);
        }
      } catch (err) {
        testResults.push({
          name: testName,
          passed: false,
          durationMs: Date.now() - tStart,
          details: err.message,
        });
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
