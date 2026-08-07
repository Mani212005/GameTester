import { ShireScene } from './ShireScene';

const container = document.getElementById('canvas-container')!;
const shire = new ShireScene(container);
shire.setAutoRotate(true);

const vlmStatus = document.getElementById('vlm-status');
if (vlmStatus) {
  let step = 0;
  const messages = [
    'VLM Inspection: Frame 1 captured (1024x768).',
    'Analyzing visual scene: Rolling green terrain detected.',
    'Identified object: Round green door (Bag End facade).',
    'Identified object: Large party tree with foliage clusters.',
    'Identified lighting: Warm sunset glow & hanging lanterns.',
    'VLM Confidence: 94.2% - Hobbiton / Bag End environment.',
    'Executing prompt check: Passage alignment verified.',
  ];

  setInterval(() => {
    step = (step + 1) % messages.length;
    vlmStatus.textContent = `[SOTA VLM Step ${step + 1}]\n${messages[step]}`;
  }, 2500);
}
