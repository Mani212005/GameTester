import { FPSGame } from './FPSGame';

const container = document.getElementById('canvas-container')!;
const game = new FPSGame(container);

const vlmStatus = document.getElementById('vlm-status');
const hudAmmo = document.getElementById('hud-ammo');
const hudScore = document.getElementById('hud-score');
const hudWave = document.getElementById('hud-wave');

if (vlmStatus) {
  let step = 0;
  const messages = [
    'VLM Frame Capture (1024x768): Scanning tactical arena...',
    'Detected Target Bot at coordinate (-8.4, 0.9, -12.1).',
    'Simulating mouse click sightline raycast shot...',
    'Target hit detected! Updating visual HUD score.',
    'Assessing gun ammo levels: 28 rounds remaining in magazine.',
    'VLM Tactical Evaluation: Cover position clear, wave 1 active.',
  ];

  setInterval(() => {
    step = (step + 1) % messages.length;
    vlmStatus.textContent = `[SOTA VLM Step ${step + 1}]\n${messages[step]}`;
  }, 2200);
}

// Update HUD
setInterval(() => {
  const state = game.getState();
  if (hudAmmo) hudAmmo.textContent = `${state.player.ammo.current} / ${state.player.ammo.reserve}`;
  if (hudScore) hudScore.textContent = `${state.player.score}`;
  if (hudWave) hudWave.textContent = `WAVE ${state.player.wave}`;
}, 100);
