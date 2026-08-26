// Shared helpers for the Claude-authored builds (src/claude/*).
// Independent from the original src/minecraft, src/action_fps, src/lotr modules.

export function fakeNoise2D(x: number, z: number): number {
  // Deterministic multi-octave sine/cosine height field - no external noise lib.
  let h = 0;
  h += Math.sin(x * 0.12) * Math.cos(z * 0.1) * 2.4;
  h += Math.sin(x * 0.045 + 4.1) * Math.cos(z * 0.05 + 1.7) * 3.6;
  h += Math.sin((x + z) * 0.02) * 1.8;
  h += Math.sin(x * 0.3 + z * 0.21) * 0.4;
  return h;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function playTone(
  ctx: AudioContext,
  freq: number,
  durationMs: number,
  type: OscillatorType = 'sine',
  gainPeak = 0.12
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.4), ctx.currentTime + durationMs / 1000);
  gain.gain.setValueAtTime(gainPeak, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durationMs / 1000);
}

export interface QAState {
  fps: number;
  stepCount: number;
  [key: string]: unknown;
}

/** Minimal window.qaHook-shaped observer, shared by every Claude build. */
export function installQAHook(getState: () => QAState, step: (deltaMs?: number) => QAState) {
  if (import.meta.env.VITE_ENABLE_QA_HOOK === 'true' || import.meta.env.DEV) {
    (window as any).qaHook = {
      getSceneState: getState,
      step,
      assertState: (fn: (s: QAState) => boolean | { pass: boolean; message: string }) => {
        const s = getState();
        const r = fn(s);
        if (typeof r === 'boolean') return { pass: r, message: r ? 'ok' : 'failed', state: s };
        return { ...r, state: s };
      },
    };
  }
}
