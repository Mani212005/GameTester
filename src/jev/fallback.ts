/**
 * Deterministic Heuristic Fallback for Jev Physics Triage.
 *
 * Evaluates engine signals deterministically when Jev API is unavailable,
 * timed out, disabled, or unconfigured.
 *
 * Follows the proven Bolo pattern: always returns a structured decision with
 * confidence, strictly biased toward flagging or failing when unsure so that
 * genuine physics regressions are never accidentally auto-passed.
 */

import { CONFIDENCE_THRESHOLDS } from './constants.ts';
import type { FailureCause, JevDecisionResult, PhysicsEngineSignals } from './types.ts';

/**
 * Executes the deterministic fallback evaluation on physics engine signals.
 */
export function evaluateDeterministicFallback(signals: PhysicsEngineSignals): JevDecisionResult {
  const {
    expected,
    actual,
    tolerance,
    delta,
    penetrationDepth = 0,
    boundingOverlap = false,
  } = signals;

  // 1. Check for State Desync or Teleportation (NaN, Infinity, or sudden warp)
  if (hasNonFiniteOrWarp(expected, actual)) {
    return {
      cause: 'state_desync_teleport',
      confidence: 0.95,
      severityScore: 3.5,
      model: 'deterministic_fallback_heuristic',
    };
  }

  // 2. Check for True Clipping or Collision Tunneling
  // Signals: significant bounding box penetration into solid geometry,
  // or unexpected ground loss (falling through floor).
  const isGroundLost = expected.isGrounded === true && actual.isGrounded === false;
  if (
    penetrationDepth >= CONFIDENCE_THRESHOLDS.PENETRATION_CLIPPING_THRESHOLD ||
    (boundingOverlap && penetrationDepth > 0.005) ||
    isGroundLost
  ) {
    return {
      cause: 'true_clipping',
      confidence: isGroundLost ? 0.95 : 0.90,
      severityScore: 3.8,
      model: 'deterministic_fallback_heuristic',
    };
  }

  // 3. Compute absolute position and velocity deltas
  const posDelta = computePositionDelta(expected, actual, delta?.position);
  const velDelta = computeVelocityDelta(expected, actual, delta?.velocity);

  // 4. Check for Collision Manifold / Impulse Explosion
  // Unphysically large velocity change without corresponding input
  if (velDelta > 15.0) {
    return {
      cause: 'collision_manifold_failure',
      confidence: 0.88,
      severityScore: 3.2,
      model: 'deterministic_fallback_heuristic',
    };
  }

  // 5. Check for Input Injection Lag
  // e.g. velocity delta matches an unapplied impulse, or position lag matches ~1 step of motion
  const dt = signals.dt ?? 0.016666;
  const expectedStepMotion = typeof expected.velocity === 'number'
    ? expected.velocity * dt
    : typeof expected.velocity === 'object' && expected.velocity !== null && 'z' in expected.velocity
    ? Math.abs((expected.velocity as any).z) * dt
    : 0;

  if (
    expectedStepMotion > 0.01 &&
    Math.abs(posDelta - expectedStepMotion) < 0.005 &&
    penetrationDepth === 0
  ) {
    return {
      cause: 'input_injection_lag',
      confidence: 0.82,
      severityScore: 2.0,
      model: 'deterministic_fallback_heuristic',
    };
  }

  // 6. Check for Float Variance Drift Envelope
  // Reference baseline tolerances:
  const posTol = tolerance?.position ?? 0.005; // 5mm
  const velTol = tolerance?.velocity ?? 0.15;  // 0.15 m/s

  const withinDriftEnvelope =
    posDelta <= CONFIDENCE_THRESHOLDS.MAX_FLOAT_DRIFT_POSITION_DELTA &&
    velDelta <= CONFIDENCE_THRESHOLDS.MAX_FLOAT_DRIFT_VELOCITY_DELTA &&
    penetrationDepth === 0 &&
    !boundingOverlap;

  if (withinDriftEnvelope) {
    // Calibrate confidence based on distance from baseline tolerance
    // If within 2x baseline tolerance: high confidence float drift
    if (posDelta <= posTol * 2.0 && velDelta <= velTol * 1.5) {
      return {
        cause: 'float_variance_drift',
        confidence: 0.92, // Meets HIGH_CONFIDENCE_AUTO_PASS (>= 0.85)
        severityScore: 0.2,
        model: 'deterministic_fallback_heuristic',
      };
    }

    // If in the outer margin (2x to 5x tolerance): lower confidence -> will flag for human inspection!
    return {
      cause: 'float_variance_drift',
      confidence: 0.72, // Below HIGH_CONFIDENCE_AUTO_PASS, triggers human inspection
      severityScore: 1.2,
      model: 'deterministic_fallback_heuristic',
    };
  }

  // 7. General Logic Regression (Default when divergence exceeds physical bounds)
  return {
    cause: 'logic_regression',
    confidence: 0.85,
    severityScore: 2.8,
    model: 'deterministic_fallback_heuristic',
  };
}

function hasNonFiniteOrWarp(expected: any, actual: any): boolean {
  const checkValues = (obj: any): boolean => {
    if (obj == null) return false;
    if (typeof obj === 'number') {
      return !Number.isFinite(obj);
    }
    if (typeof obj === 'object') {
      return Object.values(obj).some(checkValues);
    }
    return false;
  };

  if (checkValues(expected) || checkValues(actual)) {
    return true;
  }

  // Check sudden position warp (> 5 meters in a single step)
  const posDelta = computePositionDelta(expected, actual);
  return posDelta > 5.0;
}

function computePositionDelta(expected: any, actual: any, explicitDelta?: number): number {
  if (typeof explicitDelta === 'number' && Number.isFinite(explicitDelta)) {
    return explicitDelta;
  }

  const expPos = expected?.position;
  const actPos = actual?.position;

  if (typeof expPos === 'number' && typeof actPos === 'number') {
    return Math.abs(actPos - expPos);
  }

  if (
    typeof expPos === 'object' &&
    typeof actPos === 'object' &&
    expPos !== null &&
    actPos !== null
  ) {
    const dx = (actPos.x ?? 0) - (expPos.x ?? 0);
    const dy = (actPos.y ?? 0) - (expPos.y ?? 0);
    const dz = (actPos.z ?? 0) - (expPos.z ?? 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  return 0;
}

function computeVelocityDelta(expected: any, actual: any, explicitDelta?: number): number {
  if (typeof explicitDelta === 'number' && Number.isFinite(explicitDelta)) {
    return explicitDelta;
  }

  const expVel = expected?.velocity;
  const actVel = actual?.velocity;

  if (typeof expVel === 'number' && typeof actVel === 'number') {
    return Math.abs(actVel - expVel);
  }

  if (
    typeof expVel === 'object' &&
    typeof actVel === 'object' &&
    expVel !== null &&
    actVel !== null
  ) {
    const dvx = (actVel.x ?? 0) - (expVel.x ?? 0);
    const dvy = (actVel.y ?? 0) - (expVel.y ?? 0);
    const dvz = (actVel.z ?? 0) - (expVel.z ?? 0);
    return Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
  }

  return 0;
}
