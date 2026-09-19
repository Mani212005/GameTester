/**
 * Constants and explicit thresholds for Jev headless physics failure triage.
 */

import type { FailureCause } from './types.ts';

export const DEFAULT_TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
export const DEFAULT_MODEL = 'typesafe/jev-1.13';
export const DEFAULT_TIMEOUT_MS = 400; // Sub-400ms fast decision budget as in Bolo

/**
 * Explicit confidence and safety bounds for triage decisions.
 *
 * BIAS PRINCIPLE:
 * We do NOT let triage auto-pass a genuine regression.
 * Float variance drift is only auto-passed when confidence >= HIGH_CONFIDENCE_AUTO_PASS
 * AND physical deltas are within strict float variance drift ceilings.
 * Everything else is either flagged for human visual inspection or failed as a regression.
 */
export const CONFIDENCE_THRESHOLDS = {
  /** High confidence floor for auto-marking float variance drift as a flaky pass */
  HIGH_CONFIDENCE_AUTO_PASS: 0.85,
  /** Confidence floor below which decisions are flagged for human inspection */
  LOW_CONFIDENCE_FLAG_INSPECTION: 0.70,
  /** Absolute position delta ceiling (meters) that can ever qualify for float drift auto-pass */
  MAX_FLOAT_DRIFT_POSITION_DELTA: 0.05, // 5cm
  /** Absolute velocity delta ceiling (m/s) that can ever qualify for float drift auto-pass */
  MAX_FLOAT_DRIFT_VELOCITY_DELTA: 0.50, // 0.5 m/s
  /** Penetration depth threshold (meters) above which true clipping is declared */
  PENETRATION_CLIPPING_THRESHOLD: 0.02, // 2cm
} as const;

/**
 * Closed set criteria descriptions passed to Jev Choice primitive.
 */
export const FAILURE_CAUSE_CRITERIA: Record<FailureCause, string> = {
  float_variance_drift:
    'Harmless microscopic floating-point rounding variance or solver iteration drift across architectures with no gross mesh penetration, no missing contacts, and continuous trajectory alignment',
  true_clipping:
    'Physical interpenetration, tunneling through static or dynamic colliders (floor/wall/terrain), missing contact manifolds, or falling out of bounds',
  input_injection_lag:
    'Input events delayed, dropped, or misaligned with simulation ticks causing discrete phase/timing offset in actor movement',
  collision_manifold_failure:
    'Abnormal collision response, restitution/bounce explosion, corrupted contact normals, or abnormal rebound forces',
  state_desync_teleport:
    'Discontinuous position warp, NaN or infinite vector coordinates, or sudden unphysical displacement between steps',
  logic_regression:
    'Deterministic game logic failure, broken game state invariant, worldgen seed mismatch, or incorrect gameplay state transition',
};

/**
 * Criteria levels for optional severity score question.
 */
export const SEVERITY_LEVELS: string[] = [
  'Harmless microscopic float jitter with zero gameplay impact',
  'Minor drift or sub-frame timing offset that self-corrects',
  'Noticeable physics discrepancy requiring human review',
  'Critical physics bug: clipping, tunneling, or invariant breakdown',
];
