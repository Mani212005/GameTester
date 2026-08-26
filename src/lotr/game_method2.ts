import { ShireScene } from './ShireScene';

const container = document.getElementById('canvas-container')!;
const shire = new ShireScene(container);
shire.setAutoRotate(true);

// Register LOTR QAHook (gated in production)
if (import.meta.env.VITE_ENABLE_QA_HOOK === 'true') {
  (window as any).qaHook = {
    isManualMode: () => false,
    getSceneState: () => ({
      timestamp: Date.now(),
      environment: '3D Procedural Shire (Hobbiton / Bag End)',
      bagEndDoor: { state: 'Closed', color: '#1e6b37', location: { x: 0, y: 2.2, z: -16.65 } },
      partyTree: { status: 'Majestic Canopy Active', location: { x: 12, y: 0, z: 5 } },
      lanternCount: 9,
      fireflyCount: 80,
      cameraPos: {
        x: Number(shire.camera.position.x.toFixed(2)),
        y: Number(shire.camera.position.y.toFixed(2)),
        z: Number(shire.camera.position.z.toFixed(2)),
      },
    }),
    step: (_deltaMs: number = 16.666) => {
      return (window as any).qaHook.getSceneState();
    },
    resetWorld: () => {
      shire.camera.position.set(0, 5, 25);
    },
    getCapabilities: () => ['procedural-terrain', 'lighting', 'fireflies', 'orbit', 'camera'],
  };
}

// UI button controls if present
const btnToggleRotate = document.getElementById('btn-toggle-rotate');
if (btnToggleRotate) {
  let isRotating = true;
  btnToggleRotate.addEventListener('click', () => {
    isRotating = !isRotating;
    shire.setAutoRotate(isRotating);
    btnToggleRotate.textContent = isRotating ? '⏸ Pause Orbit' : '▶ Resume Orbit';
  });
}

const btnToggleWalk = document.getElementById('btn-toggle-walk');
if (btnToggleWalk) {
  btnToggleWalk.addEventListener('click', () => {
    const isWalk = shire.toggleWalkthrough();
    btnToggleWalk.textContent = isWalk ? '🎥 Orbit Camera View' : '🚶 FPS Walkthrough Mode';
  });
}
