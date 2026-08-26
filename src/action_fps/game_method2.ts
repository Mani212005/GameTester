import { FPSGame } from './FPSGame';

const container = document.getElementById('canvas-container')!;
const game = new FPSGame(container);

// Expose complete window.qaHook for Action FPS Benchmark (gated in production)
if (import.meta.env.VITE_ENABLE_QA_HOOK === 'true') {
  (window as any).qaHook = {
  isManualMode: () => false,
  getSceneState: () => game.getState(),
  step: (deltaMs: number = 16.666) => game.step(deltaMs),
  injectInput: (action: string) => {
    if (action === 'shoot') game.shoot();
    if (action === 'reload') game.reload();
  },
  resetPlayer: () => {
    game.playerBody.position.set(0, 1.8, 15);
    game.playerBody.velocity.set(0, 0, 0);
    game.health = 100;
    game.currentAmmo = 30;
    game.reserveAmmo = 120;
    game.score = 0;
    game.wave = 1;
    game.spawnWave(1);
  },
};
}

const hudAmmo = document.getElementById('hud-ammo');
const hudScore = document.getElementById('hud-score');
const hudWave = document.getElementById('hud-wave');
const hudAccuracy = document.getElementById('hud-accuracy');

// Update Live HUD
setInterval(() => {
  const state = game.getState();
  if (hudAmmo) hudAmmo.textContent = state.player.ammo.isReloading ? 'RELOADING...' : `${state.player.ammo.current} / ${state.player.ammo.reserve}`;
  if (hudScore) hudScore.textContent = `${state.player.score}`;
  if (hudWave) hudWave.textContent = `WAVE ${state.player.wave}`;
  if (hudAccuracy) hudAccuracy.textContent = `${state.player.accuracy}%`;
}, 50);
