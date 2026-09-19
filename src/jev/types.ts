/**
 * Type definitions for Jev-based headless physics failure triage in GameTester.
 */

export const JEV_TYPES_VERSION = '1.0.0';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface BoundingBox {
  min: Vector3D;
  max: Vector3D;
}

/**
 * Real failure taxonomy for headless physics test divergences.
 */
export type FailureCause =
  | 'float_variance_drift'
  | 'true_clipping'
  | 'input_injection_lag'
  | 'collision_manifold_failure'
  | 'state_desync_teleport'
  | 'logic_regression';

/**
 * Triage outcome action after confidence gating and physical bounds check.
 */
export type TriageAction =
  | 'AUTO_PASS_FLAKY'
  | 'FLAG_HUMAN_INSPECTION'
  | 'FAIL_REGRESSION';

/**
 * Engine signals collected from the test runner and physics simulation.
 */
export interface PhysicsEngineSignals {
  testName: string;
  assertionLabel?: string;
  stepCount?: number;
  dt?: number;
  expected: {
    position?: Vector3D | number;
    velocity?: Vector3D | number;
    boundingBox?: BoundingBox;
    isGrounded?: boolean;
    collidingWith?: string[];
    [key: string]: unknown;
  };
  actual: {
    position?: Vector3D | number;
    velocity?: Vector3D | number;
    boundingBox?: BoundingBox;
    isGrounded?: boolean;
    collidingWith?: string[];
    [key: string]: unknown;
  };
  tolerance?: {
    position?: number;
    velocity?: number;
    angle?: number;
    [key: string]: number | undefined;
  };
  delta?: {
    position?: number;
    velocity?: number;
    scalar?: number;
    [key: string]: number | undefined;
  };
  penetrationDepth?: number;
  boundingOverlap?: boolean;
  contactCount?: number;
  contacts?: Array<{
    bodyA: string;
    bodyB: string;
    normal?: Vector3D;
    depth?: number;
  }>;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

/**
 * TypeSafe / Jev choice question definition.
 */
export interface JevChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

/**
 * TypeSafe / Jev score question definition.
 */
export interface JevScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

/**
 * TypeSafe HTTP API request payload shape.
 */
export interface JevDecisionRequestPayload {
  model: string;
  state: Record<string, unknown> | string;
  questions: {
    failure_cause: JevChoiceQuestion;
    severity?: JevScoreQuestion;
    [key: string]: unknown;
  };
}

/**
 * Choice answer from Jev.
 */
export interface JevChoiceAnswer {
  type: 'choice';
  choice: FailureCause | string;
  probabilities?: Record<string, number>;
  confidence: number;
}

/**
 * Score answer from Jev.
 */
export interface JevScoreAnswer {
  type: 'score';
  score: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence: number;
}

/**
 * Response from TypeSafe / Jev decision call.
 */
export interface JevDecisionResult {
  cause: FailureCause;
  confidence: number;
  probabilities?: Record<FailureCause, number>;
  severityScore?: number;
  model: string;
  rawResponse?: unknown;
}

/**
 * Final triage decision returned to the test harness.
 */
export interface TriageResult {
  action: TriageAction;
  cause: FailureCause;
  confidence: number;
  probabilities?: Record<FailureCause, number>;
  severityScore?: number;
  reason: string;
  source: 'jev' | 'heuristic_fallback';
  signals: PhysicsEngineSignals;
  autoMarkedPass: boolean;
  requiresHumanReview: boolean;
  timestamp: number;
}

/**
 * Configuration options for Jev triage client.
 */
export interface JevTriageConfig {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  enabled?: boolean;
  highConfidenceThreshold?: number;
  lowConfidenceThreshold?: number;
  maxFloatDriftPositionDelta?: number;
  maxFloatDriftVelocityDelta?: number;
  fetchFn?: typeof fetch;
  mockDecisionHandler?: (signals: PhysicsEngineSignals) => Promise<JevDecisionResult> | JevDecisionResult;
}
