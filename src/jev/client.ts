/**
 * Jev decision client for TypeSafe / OpenRouter System One API.
 *
 * Provides fast (sub-400ms) decision-making for classifying headless physics test failures.
 * Injectable/mockable so test suites never hit the live API.
 */

import {
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TYPESAFE_ENDPOINT,
  DEFAULT_OPENROUTER_ENDPOINT,
  FAILURE_CAUSE_CRITERIA,
  SEVERITY_LEVELS,
} from './constants.ts';
import type {
  FailureCause,
  JevChoiceAnswer,
  JevDecisionRequestPayload,
  JevDecisionResult,
  JevScoreAnswer,
  PhysicsEngineSignals,
} from './types.ts';

export interface JevClientOptions {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * Builds the structured state payload sent to Jev, prioritizing signals
 * that distinguish real physical regressions (clipping, manifold failure)
 * from float variance drift.
 */
export function buildEngineState(signals: PhysicsEngineSignals): Record<string, unknown> {
  const {
    testName,
    assertionLabel,
    stepCount,
    dt,
    expected,
    actual,
    tolerance,
    delta,
    penetrationDepth,
    boundingOverlap,
    contactCount,
    contacts,
    errorMessage,
    metadata,
  } = signals;

  // Calculate position delta if not explicitly supplied
  let computedPositionDelta: number | undefined = delta?.position;
  if (computedPositionDelta === undefined && expected?.position && actual?.position) {
    if (typeof expected.position === 'number' && typeof actual.position === 'number') {
      computedPositionDelta = Math.abs(actual.position - expected.position);
    } else if (
      typeof expected.position === 'object' &&
      typeof actual.position === 'object' &&
      'x' in expected.position &&
      'x' in actual.position
    ) {
      const expPos = expected.position as { x: number; y: number; z: number };
      const actPos = actual.position as { x: number; y: number; z: number };
      const dx = actPos.x - expPos.x;
      const dy = actPos.y - expPos.y;
      const dz = actPos.z - expPos.z;
      computedPositionDelta = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }

  // Calculate velocity delta if not explicitly supplied
  let computedVelocityDelta: number | undefined = delta?.velocity;
  if (computedVelocityDelta === undefined && expected?.velocity && actual?.velocity) {
    if (typeof expected.velocity === 'number' && typeof actual.velocity === 'number') {
      computedVelocityDelta = Math.abs(actual.velocity - expected.velocity);
    } else if (
      typeof expected.velocity === 'object' &&
      typeof actual.velocity === 'object' &&
      'x' in expected.velocity &&
      'x' in actual.velocity
    ) {
      const expVel = expected.velocity as { x: number; y: number; z: number };
      const actVel = actual.velocity as { x: number; y: number; z: number };
      const dvx = actVel.x - expVel.x;
      const dvy = actVel.y - expVel.y;
      const dvz = actVel.z - expVel.z;
      computedVelocityDelta = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
    }
  }

  return {
    test_context: {
      test_name: testName,
      assertion_label: assertionLabel || 'Physics Assertion',
      step_count: stepCount ?? 0,
      delta_time_ms: dt ? dt * 1000 : 16.666,
      error_message: errorMessage || 'Assertion divergence detected',
    },
    kinematics: {
      expected: {
        position: expected.position,
        velocity: expected.velocity,
        is_grounded: expected.isGrounded,
        bounding_box: expected.boundingBox,
      },
      actual: {
        position: actual.position,
        velocity: actual.velocity,
        is_grounded: actual.isGrounded,
        bounding_box: actual.boundingBox,
      },
      tolerances: {
        position: tolerance?.position,
        velocity: tolerance?.velocity,
        angle: tolerance?.angle,
      },
      divergence: {
        position_delta_meters: computedPositionDelta,
        velocity_delta_ms: computedVelocityDelta,
        raw_delta: delta,
      },
    },
    geometry_and_contacts: {
      penetration_depth_meters: penetrationDepth ?? 0.0,
      bounding_box_overlap: Boolean(boundingOverlap),
      active_contact_count: contactCount ?? contacts?.length ?? 0,
      contacts: (contacts || []).map((c) => ({
        body_a: c.bodyA,
        body_b: c.bodyB,
        depth: c.depth ?? 0,
        normal: c.normal,
      })),
    },
    metadata: metadata || {},
  };
}

/**
 * Builds the full JSON payload for TypeSafe / OpenRouter decisions API.
 */
export function buildDecisionRequest(
  signals: PhysicsEngineSignals,
  model: string = DEFAULT_MODEL
): JevDecisionRequestPayload {
  const state = buildEngineState(signals);

  return {
    model,
    state,
    questions: {
      failure_cause: {
        type: 'choice',
        instructions:
          'Classify the root cause of this headless physics test divergence into the closed failure taxonomy.',
        criteria: FAILURE_CAUSE_CRITERIA,
      },
      severity: {
        type: 'score',
        instructions:
          'Rate the physical severity of this failure or divergence from harmless float drift to critical regression.',
        criteria: SEVERITY_LEVELS,
      },
    },
  };
}

/**
 * Parses the JSON response from TypeSafe (or OpenRouter) into a normalized JevDecisionResult.
 */
export function parseDecisionResponse(json: any, defaultModel: string): JevDecisionResult {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid response: payload must be a JSON object');
  }

  if (json.error) {
    const msg = typeof json.error === 'string' ? json.error : json.error.message || JSON.stringify(json.error);
    throw new Error(`Jev API error: ${msg}`);
  }

  const model = json.model || defaultModel;
  const answers = json.answers || json.decisions || json;

  // 1. Parse failure_cause choice
  let cause: FailureCause = 'logic_regression';
  let confidence = 0.5;
  let probabilities: Record<FailureCause, number> | undefined;

  const failureCauseAnswer = answers.failure_cause;
  if (failureCauseAnswer) {
    if (typeof failureCauseAnswer === 'string') {
      cause = normalizeFailureCause(failureCauseAnswer);
      confidence = 0.8;
    } else if (typeof failureCauseAnswer === 'object') {
      const rawChoice =
        failureCauseAnswer.choice ??
        failureCauseAnswer.value ??
        failureCauseAnswer.selected ??
        'logic_regression';
      cause = normalizeFailureCause(String(rawChoice));

      if (typeof failureCauseAnswer.confidence === 'number') {
        confidence = failureCauseAnswer.confidence;
      } else if (failureCauseAnswer.probabilities && typeof failureCauseAnswer.probabilities === 'object') {
        const probs = failureCauseAnswer.probabilities as Record<string, number>;
        confidence = probs[cause] ?? 0.5;
      }

      if (failureCauseAnswer.probabilities && typeof failureCauseAnswer.probabilities === 'object') {
        probabilities = failureCauseAnswer.probabilities as Record<FailureCause, number>;
      }
    }
  }

  // 2. Parse severity score (if present)
  let severityScore: number | undefined;
  const severityAnswer = answers.severity;
  if (severityAnswer) {
    if (typeof severityAnswer === 'number') {
      severityScore = severityAnswer;
    } else if (typeof severityAnswer === 'object') {
      if (typeof severityAnswer.score === 'number') {
        severityScore = severityAnswer.score;
      } else if (typeof severityAnswer.value === 'number') {
        severityScore = severityAnswer.value;
      }
    }
  }

  return {
    cause,
    confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(4)),
    probabilities,
    severityScore,
    model,
    rawResponse: json,
  };
}

/**
 * Normalizes any variation in string response to the exact FailureCause union.
 */
function normalizeFailureCause(str: string): FailureCause {
  const clean = str.trim().toLowerCase().replace(/[-\s]+/g, '_');
  switch (clean) {
    case 'float_variance_drift':
    case 'float_drift':
    case 'variance_drift':
    case 'float_variance':
      return 'float_variance_drift';
    case 'true_clipping':
    case 'clipping':
    case 'tunneling':
      return 'true_clipping';
    case 'input_injection_lag':
    case 'input_lag':
    case 'injection_lag':
      return 'input_injection_lag';
    case 'collision_manifold_failure':
    case 'manifold_failure':
    case 'collision_failure':
      return 'collision_manifold_failure';
    case 'state_desync_teleport':
    case 'state_desync':
    case 'teleport':
    case 'desync':
      return 'state_desync_teleport';
    default:
      return 'logic_regression';
  }
}

/**
 * Fast Jev Decision Client.
 */
export class JevClient {
  private apiKey: string | null;
  private endpoint: string;
  private model: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: JevClientOptions = {}) {
    const env =
      typeof globalThis !== 'undefined' && (globalThis as any).process?.env
        ? (globalThis as any).process.env
        : undefined;

    const typesafeKey = env?.TYPESAFE_API_KEY || env?.JEV_API_KEY;
    const openrouterKey = env?.OPENROUTER_API_KEY;

    this.apiKey = options.apiKey !== undefined ? options.apiKey : (typesafeKey || openrouterKey || null);

    this.endpoint =
      options.endpoint ||
      (!typesafeKey && openrouterKey
        ? DEFAULT_OPENROUTER_ENDPOINT
        : DEFAULT_TYPESAFE_ENDPOINT);
    this.model = options.model || DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  public hasApiKey(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Dispatches a fast decision request to Jev with timeout control.
   */
  public async decide(signals: PhysicsEngineSignals): Promise<JevDecisionResult> {
    if (!this.hasApiKey()) {
      throw new Error('Jev API key not configured');
    }

    const payload = buildDecisionRequest(signals, this.model);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Jev HTTP ${response.status} error: ${errorText}`);
      }

      const json = await response.json();
      return parseDecisionResponse(json, this.model);
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        throw new Error(`Jev decision timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
