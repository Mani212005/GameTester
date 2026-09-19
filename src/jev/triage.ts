/**
 * Jev Physics Failure Triage Engine.
 *
 * Implements confidence-gated routing:
 * - High confidence in float_variance_drift -> auto-marks test a flaky pass.
 * - Low confidence -> flags the run for human visual inspection.
 * - True regressions (clipping, manifold failure, logic error) -> fails immediately as regression.
 * - API unavailable / timeout / unconfigured -> seamless deterministic heuristic fallback.
 */

import { JevClient } from './client.ts';
import { CONFIDENCE_THRESHOLDS } from './constants.ts';
import { evaluateDeterministicFallback } from './fallback.ts';
import type {
  FailureCause,
  JevDecisionResult,
  JevTriageConfig,
  PhysicsEngineSignals,
  TriageAction,
  TriageResult,
} from './types.ts';

export class JevTriageEngine {
  private client: JevClient;
  private config: JevTriageConfig;

  constructor(config: JevTriageConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      highConfidenceThreshold: config.highConfidenceThreshold ?? CONFIDENCE_THRESHOLDS.HIGH_CONFIDENCE_AUTO_PASS,
      lowConfidenceThreshold: config.lowConfidenceThreshold ?? CONFIDENCE_THRESHOLDS.LOW_CONFIDENCE_FLAG_INSPECTION,
      maxFloatDriftPositionDelta: config.maxFloatDriftPositionDelta ?? CONFIDENCE_THRESHOLDS.MAX_FLOAT_DRIFT_POSITION_DELTA,
      maxFloatDriftVelocityDelta: config.maxFloatDriftVelocityDelta ?? CONFIDENCE_THRESHOLDS.MAX_FLOAT_DRIFT_VELOCITY_DELTA,
      ...config,
    };

    this.client = new JevClient({
      apiKey: this.config.apiKey,
      endpoint: this.config.endpoint,
      model: this.config.model,
      timeoutMs: this.config.timeoutMs,
      fetchFn: this.config.fetchFn,
    });
  }

  /**
   * Triages a headless physics test divergence.
   */
  public async triage(signals: PhysicsEngineSignals): Promise<TriageResult> {
    let decision: JevDecisionResult;
    let source: 'jev' | 'heuristic_fallback' = 'heuristic_fallback';

    // 1. Try mock handler if injected (for test suite isolation)
    if (this.config.mockDecisionHandler) {
      decision = await this.config.mockDecisionHandler(signals);
      source = 'jev';
    }
    // 2. Try live Jev call if enabled and API key is present
    else if (this.config.enabled && this.client.hasApiKey()) {
      try {
        decision = await this.client.decide(signals);
        source = 'jev';
      } catch (err) {
        // Fall back deterministically on timeout, rate limit, or network error
        decision = evaluateDeterministicFallback(signals);
        source = 'heuristic_fallback';
      }
    }
    // 3. Fallback when API key is absent or Jev is disabled
    else {
      decision = evaluateDeterministicFallback(signals);
      source = 'heuristic_fallback';
    }

    // 4. Apply Confidence Gating & Safety Checks
    return this.applyConfidenceGating(signals, decision, source);
  }

  /**
   * Enforces confidence gating rules:
   * - Never auto-pass genuine regressions.
   * - Only auto-pass float variance drift when confidence >= highConfidenceThreshold
   *   AND physical deltas are within hard safety ceilings.
   * - Flag for human inspection when confidence is low or when unsure.
   */
  private applyConfidenceGating(
    signals: PhysicsEngineSignals,
    decision: JevDecisionResult,
    source: 'jev' | 'heuristic_fallback'
  ): TriageResult {
    const { cause, confidence, probabilities, severityScore } = decision;
    const highThreshold = this.config.highConfidenceThreshold!;
    const lowThreshold = this.config.lowConfidenceThreshold!;
    const maxPosDelta = this.config.maxFloatDriftPositionDelta!;
    const maxVelDelta = this.config.maxFloatDriftVelocityDelta!;

    // Compute actual deltas for physical safety envelope check
    const posDelta = signals.delta?.position ?? 0;
    const velDelta = signals.delta?.velocity ?? 0;
    const penetration = signals.penetrationDepth ?? 0;

    let action: TriageAction;
    let autoMarkedPass = false;
    let requiresHumanReview = false;
    let reason = '';

    if (cause === 'float_variance_drift') {
      if (confidence >= highThreshold) {
        // Safety bound enforcement: even with high confidence, physical deltas must not exceed ceilings
        const exceedsPos = posDelta > maxPosDelta;
        const exceedsVel = velDelta > maxVelDelta;
        const hasClipping = penetration >= CONFIDENCE_THRESHOLDS.PENETRATION_CLIPPING_THRESHOLD;

        if (exceedsPos || exceedsVel || hasClipping) {
          action = 'FLAG_HUMAN_INSPECTION';
          requiresHumanReview = true;
          reason = `Float variance drift classified with high confidence (${confidence.toFixed(2)}), but physical delta exceeded safety ceiling (posΔ=${posDelta.toFixed(4)}m, velΔ=${velDelta.toFixed(2)}m/s, pen=${penetration.toFixed(4)}m). Flagged for human inspection.`;
        } else {
          action = 'AUTO_PASS_FLAKY';
          autoMarkedPass = true;
          requiresHumanReview = false;
          reason = `High confidence (${confidence.toFixed(2)}) float variance drift within verified physical bounds. Auto-marked as flaky pass.`;
        }
      } else {
        // Low or moderate confidence in float variance drift -> flag for visual inspection
        action = 'FLAG_HUMAN_INSPECTION';
        requiresHumanReview = true;
        reason = `Float variance drift classified with insufficient confidence (${confidence.toFixed(2)} < ${highThreshold.toFixed(2)}). Flagged for human visual inspection.`;
      }
    } else {
      // Genuine regression candidates: true_clipping, logic_regression, input_lag, etc.
      if (confidence < lowThreshold) {
        action = 'FLAG_HUMAN_INSPECTION';
        requiresHumanReview = true;
        reason = `Low confidence (${confidence.toFixed(2)} < ${lowThreshold.toFixed(2)}) for cause '${cause}'. Flagged for human visual inspection to confirm regression.`;
      } else {
        action = 'FAIL_REGRESSION';
        requiresHumanReview = true;
        reason = `Confirmed physics regression: ${cause} (confidence: ${confidence.toFixed(2)}). Run failed.`;
      }
    }

    return {
      action,
      cause,
      confidence,
      probabilities,
      severityScore,
      reason,
      source,
      signals,
      autoMarkedPass,
      requiresHumanReview,
      timestamp: Date.now(),
    };
  }
}

/**
 * Convenience helper to triage a physics test failure with default or custom config.
 */
export async function triagePhysicsFailure(
  signals: PhysicsEngineSignals,
  config?: JevTriageConfig
): Promise<TriageResult> {
  const engine = new JevTriageEngine(config);
  return engine.triage(signals);
}
