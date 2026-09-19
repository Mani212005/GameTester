/**
 * Unit test suite for Jev Headless Physics Failure Triage.
 *
 * Tests:
 * 1. Request building and TypeSafe schema conformance
 * 2. Response parsing (Choice format, confidence, probabilities, errors)
 * 3. Confidence gating: high-confidence float drift auto-marks flaky pass
 * 4. Confidence gating: low-confidence float drift flags for visual inspection
 * 5. Safety ceiling: float drift exceeding physical bounds flags for inspection
 * 6. Genuine regression: true_clipping fails regression
 * 7. Genuine regression: manifold failure, logic regression, input lag
 * 8. Deterministic fallback when API key is absent
 * 9. Deterministic fallback on timeout (400ms budget)
 * 10. Deterministic fallback on HTTP error (500, 429)
 * 11. Mock client injection (zero live network calls)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIDENCE_THRESHOLDS,
  DEFAULT_MODEL,
  FAILURE_CAUSE_CRITERIA,
} from '../src/jev/constants.ts';
import {
  buildDecisionRequest,
  buildEngineState,
  parseDecisionResponse,
  JevClient,
} from '../src/jev/client.ts';
import { evaluateDeterministicFallback } from '../src/jev/fallback.ts';
import { JevTriageEngine, triagePhysicsFailure } from '../src/jev/triage.ts';

test('Jev Request Builder generates valid TypeSafe System One schema', () => {
  const signals = {
    testName: 'Jump Impulse Test',
    assertionLabel: 'Launch Y velocity',
    stepCount: 2,
    dt: 0.01666,
    expected: {
      position: { x: 0, y: 6.166, z: 0 },
      velocity: { x: 0, y: 6.166, z: 0 },
      isGrounded: false,
      boundingBox: { min: { x: -0.5, y: 5.666, z: -0.5 }, max: { x: 0.5, y: 6.666, z: 0.5 } },
    },
    actual: {
      position: { x: 0, y: 6.168, z: 0 },
      velocity: { x: 0, y: 6.169, z: 0 },
      isGrounded: false,
      boundingBox: { min: { x: -0.5, y: 5.668, z: -0.5 }, max: { x: 0.5, y: 6.668, z: 0.5 } },
    },
    tolerance: { velocity: 0.15, position: 0.005 },
    delta: { velocity: 0.003, position: 0.002 },
    penetrationDepth: 0,
    boundingOverlap: false,
    contacts: [],
  };

  const req = buildDecisionRequest(signals, DEFAULT_MODEL);

  assert.equal(req.model, DEFAULT_MODEL);
  assert.equal(typeof req.state, 'object');
  assert.equal(req.questions.failure_cause.type, 'choice');
  assert.equal(typeof req.questions.failure_cause.instructions, 'string');
  assert.equal(typeof req.questions.failure_cause.criteria.float_variance_drift, 'string');
  assert.equal(typeof req.questions.failure_cause.criteria.true_clipping, 'string');

  const state = req.state;
  assert.equal(state.test_context.test_name, 'Jump Impulse Test');
  assert.equal(state.kinematics.expected.is_grounded, false);
  assert.equal(state.geometry_and_contacts.penetration_depth_meters, 0);
});

test('Jev Request Builder computes deltas when position and velocity baselines are 0', () => {
  const signals = {
    testName: 'Zero Baseline Kinematics',
    expected: { position: 0, velocity: 0 },
    actual: { position: 0.004, velocity: 0.002 },
  };

  const state = buildEngineState(signals);
  assert.equal(state.kinematics.divergence.position_delta_meters, 0.004);
  assert.equal(state.kinematics.divergence.velocity_delta_ms, 0.002);
});

test('Jev Response Parser extracts choice, confidence, and probabilities from TypeSafe API', () => {
  const mockApiResponse = {
    model: 'typesafe/jev-1.13',
    answers: {
      failure_cause: {
        type: 'choice',
        choice: 'float_variance_drift',
        confidence: 0.94,
        probabilities: {
          float_variance_drift: 0.94,
          true_clipping: 0.02,
          input_injection_lag: 0.02,
          collision_manifold_failure: 0.01,
          state_desync_teleport: 0.005,
          logic_regression: 0.005,
        },
      },
      severity: {
        type: 'score',
        score: 0.15,
        confidence: 0.96,
      },
    },
    usage: { input_tokens: 145, output_tokens: 28 },
  };

  const parsed = parseDecisionResponse(mockApiResponse, DEFAULT_MODEL);
  assert.equal(parsed.cause, 'float_variance_drift');
  assert.equal(parsed.confidence, 0.94);
  assert.equal(parsed.severityScore, 0.15);
  assert.equal(parsed.probabilities.float_variance_drift, 0.94);
});

test('Jev Response Parser handles OpenRouter alternative decisions format', () => {
  const mockOpenRouterResponse = {
    model: 'typesafe/jev-1.13',
    decisions: {
      failure_cause: {
        selected: 'true_clipping',
        confidence: 0.91,
      },
    },
  };

  const parsed = parseDecisionResponse(mockOpenRouterResponse, DEFAULT_MODEL);
  assert.equal(parsed.cause, 'true_clipping');
  assert.equal(parsed.confidence, 0.91);
});

test('Jev Response Parser propagates API error messages', () => {
  const errorResponse = {
    error: { message: 'Model typesafe/jev-1.13 is overloaded' },
  };

  assert.throws(
    () => parseDecisionResponse(errorResponse, DEFAULT_MODEL),
    /overloaded/
  );
});

test('Confidence Gating: High-confidence float variance drift auto-marks FLAKY PASS', async () => {
  const engine = new JevTriageEngine({
    mockDecisionHandler: () => ({
      cause: 'float_variance_drift',
      confidence: 0.95,
      model: 'mock_jev',
      severityScore: 0.1,
    }),
  });

  const signals = {
    testName: 'Position Determinism Test',
    expected: { position: { x: 0, y: 0, z: -10 } },
    actual: { position: { x: 0, y: 0, z: -10.006 } },
    tolerance: { position: 0.005 },
    delta: { position: 0.006 },
    penetrationDepth: 0,
  };

  const result = await engine.triage(signals);

  assert.equal(result.action, 'AUTO_PASS_FLAKY');
  assert.equal(result.autoMarkedPass, true);
  assert.equal(result.requiresHumanReview, false);
  assert.equal(result.cause, 'float_variance_drift');
  assert.equal(result.confidence, 0.95);
});

test('Confidence Gating: Low-confidence float variance drift flags for HUMAN INSPECTION', async () => {
  const engine = new JevTriageEngine({
    mockDecisionHandler: () => ({
      cause: 'float_variance_drift',
      confidence: 0.62, // Below HIGH_CONFIDENCE_AUTO_PASS (0.85)
      model: 'mock_jev',
    }),
  });

  const signals = {
    testName: 'Position Determinism Test',
    expected: { position: { x: 0, y: 0, z: 0 } },
    actual: { position: { x: 0.012, y: 0, z: 0 } },
    delta: { position: 0.012 },
    penetrationDepth: 0,
  };

  const result = await engine.triage(signals);

  assert.equal(result.action, 'FLAG_HUMAN_INSPECTION');
  assert.equal(result.autoMarkedPass, false);
  assert.equal(result.requiresHumanReview, true);
  assert.match(result.reason, /insufficient confidence/i);
});

test('Safety Ceilings: Float drift exceeding max delta ceiling NEVER auto-passes', async () => {
  const engine = new JevTriageEngine({
    mockDecisionHandler: () => ({
      // Model claims float drift with 99% confidence, but delta is 0.12m (12cm) > 0.05m ceiling
      cause: 'float_variance_drift',
      confidence: 0.99,
      model: 'mock_jev',
    }),
  });

  const signals = {
    testName: 'Walk Test',
    expected: { position: { x: 0, y: 0, z: 0 } },
    actual: { position: { x: 0.12, y: 0, z: 0 } },
    delta: { position: 0.12 }, // Exceeds MAX_FLOAT_DRIFT_POSITION_DELTA (0.05)
    penetrationDepth: 0,
  };

  const result = await engine.triage(signals);

  assert.equal(result.action, 'FLAG_HUMAN_INSPECTION');
  assert.equal(result.autoMarkedPass, false);
  assert.equal(result.requiresHumanReview, true);
  assert.match(result.reason, /exceeded safety ceiling/i);
});

test('Safety Ceilings: Float drift exceeding max delta ceiling without explicit delta signal NEVER auto-passes', async () => {
  const engine = new JevTriageEngine({
    mockDecisionHandler: () => ({
      // Model claims float drift with 99% confidence, but delta is omitted and actual divergence is 0.12m > 0.05m ceiling
      cause: 'float_variance_drift',
      confidence: 0.99,
      model: 'mock_jev',
    }),
  });

  const signals = {
    testName: 'Walk Test Without Explicit Delta',
    expected: { position: 0 },
    actual: { position: 0.12 },
    penetrationDepth: 0,
  };

  const result = await engine.triage(signals);

  assert.equal(result.action, 'FLAG_HUMAN_INSPECTION');
  assert.equal(result.autoMarkedPass, false);
  assert.equal(result.requiresHumanReview, true);
  assert.match(result.reason, /exceeded safety ceiling/i);
});

test('Safety Ceilings: Float drift with clipping penetration NEVER auto-passes', async () => {
  const engine = new JevTriageEngine({
    mockDecisionHandler: () => ({
      cause: 'float_variance_drift',
      confidence: 0.95,
      model: 'mock_jev',
    }),
  });

  const signals = {
    testName: 'Wall Collision Test',
    expected: { position: { x: 0, y: 0, z: 0 } },
    actual: { position: { x: 0.008, y: 0, z: 0 } },
    delta: { position: 0.008 },
    penetrationDepth: 0.04, // 4cm clipping into wall!
    boundingOverlap: true,
  };

  const result = await engine.triage(signals);

  assert.equal(result.action, 'FLAG_HUMAN_INSPECTION');
  assert.equal(result.autoMarkedPass, false);
  assert.equal(result.requiresHumanReview, true);
});

test('Genuine Regression: true_clipping fails as FAIL_REGRESSION', async () => {
  const engine = new JevTriageEngine({
    mockDecisionHandler: () => ({
      cause: 'true_clipping',
      confidence: 0.96,
      model: 'mock_jev',
      severityScore: 3.9,
    }),
  });

  const signals = {
    testName: 'Floor Collision Test',
    expected: { position: { x: 0, y: 0, z: 0 }, isGrounded: true },
    actual: { position: { x: 0, y: -2.5, z: 0 }, isGrounded: false },
    penetrationDepth: 2.5,
  };

  const result = await engine.triage(signals);

  assert.equal(result.action, 'FAIL_REGRESSION');
  assert.equal(result.autoMarkedPass, false);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.cause, 'true_clipping');
});

test('Deterministic Fallback: Fallback classifies microscopic drift as float_variance_drift', () => {
  const signals = {
    testName: 'Exact Determinism Check',
    expected: { position: 0.0, velocity: 6.166 },
    actual: { position: 0.0052, velocity: 6.170 }, // Just over 5mm tolerance
    tolerance: { position: 0.005, velocity: 0.15 },
    delta: { position: 0.0052, velocity: 0.004 },
    penetrationDepth: 0,
    boundingOverlap: false,
  };

  const fallback = evaluateDeterministicFallback(signals);

  assert.equal(fallback.cause, 'float_variance_drift');
  assert.ok(fallback.confidence >= CONFIDENCE_THRESHOLDS.HIGH_CONFIDENCE_AUTO_PASS);
  assert.equal(fallback.model, 'deterministic_fallback_heuristic');
});

test('Deterministic Fallback: Detects true clipping when penetration depth exceeds threshold', () => {
  const signals = {
    testName: 'Floor Penetration',
    expected: { position: { x: 0, y: 1, z: 0 }, isGrounded: true },
    actual: { position: { x: 0, y: 0.8, z: 0 }, isGrounded: true },
    penetrationDepth: 0.08, // 8cm penetration into floor
    boundingOverlap: true,
  };

  const fallback = evaluateDeterministicFallback(signals);

  assert.equal(fallback.cause, 'true_clipping');
  assert.ok(fallback.confidence >= 0.90);
});

test('Deterministic Fallback: Detects state desync or teleportation on NaN or massive jump', () => {
  const signals = {
    testName: 'Physics Tick',
    expected: { position: { x: 0, y: 0, z: 0 } },
    actual: { position: { x: NaN, y: 0, z: 0 } },
  };

  const fallback = evaluateDeterministicFallback(signals);

  assert.equal(fallback.cause, 'state_desync_teleport');
  assert.ok(fallback.confidence >= 0.95);
});

test('Deterministic Fallback: Detects input injection lag when delta matches 1-frame motion', () => {
  const signals = {
    testName: 'Input Injection Move',
    dt: 0.016666,
    expected: { velocity: 5.0 }, // 5.0 m/s * 0.016666s = ~0.0833m per frame
    actual: { velocity: 0.0 },
    delta: { position: 0.0833 },
    penetrationDepth: 0,
  };

  const fallback = evaluateDeterministicFallback(signals);

  assert.equal(fallback.cause, 'input_injection_lag');
  assert.ok(fallback.confidence >= 0.80);
});

test('Client fallback on API timeout (sub-400ms constraint)', async () => {
  // Mock fetch that rejects on abort signal to simulate network timeout
  const hangingFetch = (_url, opts) =>
    new Promise((_, reject) => {
      if (opts?.signal) {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });

  const engine = new JevTriageEngine({
    apiKey: 'mock_test_key',
    timeoutMs: 30, // 30ms fast timeout
    fetchFn: hangingFetch,
  });

  const signals = {
    testName: 'Timeout Test',
    expected: { position: 0.0 },
    actual: { position: 0.0051 },
    tolerance: { position: 0.005 },
    delta: { position: 0.0051 },
    penetrationDepth: 0,
  };

  const tStart = Date.now();
  const result = await engine.triage(signals);
  const elapsed = Date.now() - tStart;

  assert.ok(elapsed < 200, `Expected quick fallback within 200ms, took ${elapsed}ms`);
  assert.equal(result.source, 'heuristic_fallback');
  assert.equal(result.cause, 'float_variance_drift');
});

test('Client fallback on HTTP 500 error from API', async () => {
  const errorFetch = async () =>
    new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

  const engine = new JevTriageEngine({
    apiKey: 'mock_test_key',
    fetchFn: errorFetch,
  });

  const signals = {
    testName: 'Error 500 Test',
    expected: { position: 0.0 },
    actual: { position: 0.0051 },
    tolerance: { position: 0.005 },
    delta: { position: 0.0051 },
    penetrationDepth: 0,
  };

  const result = await engine.triage(signals);
  assert.equal(result.source, 'heuristic_fallback');
  assert.equal(result.cause, 'float_variance_drift');
  assert.equal(result.action, 'AUTO_PASS_FLAKY');
});

test('End-to-End triagePhysicsFailure helper works with fallback when unconfigured', async () => {
  const result = await triagePhysicsFailure(
    {
      testName: 'E2E Fallback Unconfigured',
      expected: { position: 0.0 },
      actual: { position: 0.0051 },
      tolerance: { position: 0.005 },
      delta: { position: 0.0051 },
      penetrationDepth: 0,
    },
    { apiKey: '' } // explicitly unconfigured / empty key
  );

  assert.equal(result.source, 'heuristic_fallback');
  assert.equal(result.action, 'AUTO_PASS_FLAKY');
});
