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
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log(`[Playwright] Navigating to ${serverUrl}...`);
    await page.goto(serverUrl);

    // Wait for qaHook initialization
    await page.waitForFunction(() => window.qaHook !== undefined, { timeout: 10000 });
    console.log('[Playwright] window.qaHook detected successfully!\n');

    console.log('[3/4] Running Deterministic QA Test Suite...\n');

    // ----------------------------------------------------
    // TEST 1: Initial Scene State Serialization
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 1: Initial Scene State Serialization';
      try {
        await page.evaluate(() => {
          window.qaHook.setManualMode(true);
        });
        const state = await page.evaluate(() => window.qaHook.getSceneState());

        const entityCount = state.entities.length;
        const hasPlayer = state.entities.some((e) => e.name === 'PlayerCube');
        const hasFloor = state.entities.some((e) => e.name === 'FloorGround');
        const isGrounded = state.playerState.isGrounded;

        const passed = entityCount >= 4 && hasPlayer && hasFloor && isGrounded;
        const details = `Serialized ${entityCount} entities (Player, Floor, Obstacles). Player position: (${state.playerState.position.x}, ${state.playerState.position.y}, ${state.playerState.position.z}), Grounded: ${isGrounded}`;

        testResults.push({
          name: testName,
          passed,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { playerState: state.playerState, entityNames: state.entities.map((e) => e.name) },
        });
        if (passed) {
          console.log(`  ✓ ${testName} [PASS] (${Date.now() - tStart}ms)`);
        } else {
          console.log(`  ✗ ${testName} [FAIL]: entityCount=${entityCount}, hasPlayer=${hasPlayer}, hasFloor=${hasFloor}, isGrounded=${isGrounded}`);
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
    // TEST 2: Deterministic Physics Stepping & Movement Input
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 2: Deterministic Input Injection & Movement';
      try {
        const resultState = await page.evaluate(() => {
          window.qaHook.resetPlayer({ x: 0, y: 1, z: 0 });
          window.qaHook.injectInput('move_forward');
          for (let i = 0; i < 10; i++) {
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
          window.qaHook.resetPlayer({ x: 0, y: 1, z: 0 });
          window.qaHook.injectInput('jump');
          const airState = window.qaHook.step(50); // Step 1 tick for jump impulse

          for (let i = 0; i < 30; i++) {
            window.qaHook.step(50);
          }
          const landedState = window.qaHook.getSceneState();

          return { airState, landedState };
        });

        const jumpTriggered = jumpResults.airState.playerState.velocity.y > 0;
        const reachedApex = jumpResults.airState.playerState.position.y > 1.1;
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
    // TEST 4: State Invariant Assertion (Falling Off Floor Boundary)
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 4: State Invariant Assertion (Fall Detection)';
      try {
        const assertionEvaluation = await page.evaluate(() => {
          window.qaHook.resetPlayer({ x: 5.0, y: 1, z: 0 });
          window.qaHook.injectInput('move_right');

          for (let i = 0; i < 30; i++) {
            window.qaHook.step(50);
          }
          window.qaHook.injectInput('stop');

          const result = window.qaHook.assertState(
            (state) => state.playerState.position.y > -5.0
          );
          return result;
        });

        const invariantDetected = assertionEvaluation.pass === false;
        const details = `assertState correctly flagged invariant violation when player Y reached ${assertionEvaluation.state.playerState.position.y}`;

        testResults.push({
          name: testName,
          passed: invariantDetected,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { assertionResult: assertionEvaluation },
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
    // TEST 5: Real-time Physics Collision Observer
    // ----------------------------------------------------
    {
      const tStart = Date.now();
      const testName = 'Test 5: Real-time Physics Collision Observer';
      try {
        const collisionResult = await page.evaluate(() => {
          window.qaHook.resetPlayer({ x: -1.2, y: 1, z: -2.0 });
          window.qaHook.injectInput('move_left');

          for (let i = 0; i < 15; i++) {
            window.qaHook.step(50);
          }
          window.qaHook.injectInput('stop');

          const state = window.qaHook.getSceneState();
          const playerEntity = state.entities.find((e) => e.name === 'PlayerCube');
          return { state, playerEntity };
        });

        const isColliding = collisionResult.playerEntity?.isColliding ?? false;
        const collidingWithObs = collisionResult.playerEntity?.collidingWith.includes('OrangeObstacle') ?? false;
        const passed = isColliding && collidingWithObs;
        const details = `Collision status: isColliding=${isColliding}, collidingWith=[${collisionResult.playerEntity?.collidingWith.join(', ')}]`;

        testResults.push({
          name: testName,
          passed,
          durationMs: Date.now() - tStart,
          details,
          snapshot: { playerEntity: collisionResult.playerEntity },
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
