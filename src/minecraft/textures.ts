import * as THREE from 'three';
import { BlockType } from './types';

// Helper to generate a procedural 16x16 pixel texture canvas
function createPixelTexture(
  drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  drawFn(ctx, 16, 16);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// 1. Grass Top Texture
const grassTopTex = createPixelTexture((ctx, w, h) => {
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(0, 0, w, h);
  const greens = ['#16a34a', '#15803d', '#4ade80', '#22c55e'];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (Math.random() > 0.4) {
        ctx.fillStyle = greens[Math.floor(Math.random() * greens.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
});

// 2. Dirt Texture
const dirtTex = createPixelTexture((ctx, w, h) => {
  ctx.fillStyle = '#854d0e';
  ctx.fillRect(0, 0, w, h);
  const browns = ['#713f12', '#a16207', '#581c87', '#92400e'];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (Math.random() > 0.35) {
        ctx.fillStyle = browns[Math.floor(Math.random() * browns.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
});

// 3. Grass Side Texture (Dirt with Green Rim at top)
const grassSideTex = createPixelTexture((ctx, w, h) => {
  // Fill dirt base
  ctx.fillStyle = '#854d0e';
  ctx.fillRect(0, 0, w, h);
  const browns = ['#713f12', '#a16207', '#92400e'];
  for (let x = 0; x < w; x++) {
    for (let y = 3; y < h; y++) {
      if (Math.random() > 0.4) {
        ctx.fillStyle = browns[Math.floor(Math.random() * browns.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // Draw top grass layer with drip details
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(0, 0, w, 3);
  for (let x = 0; x < w; x++) {
    const dripLen = Math.floor(Math.random() * 3);
    if (dripLen > 0) {
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(x, 3, 1, dripLen);
    }
  }
});

// 4. Stone Texture
const stoneTex = createPixelTexture((ctx, w, h) => {
  ctx.fillStyle = '#64748b';
  ctx.fillRect(0, 0, w, h);
  const greys = ['#475569', '#334155', '#94a3b8', '#cbd5e1'];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (Math.random() > 0.3) {
        ctx.fillStyle = greys[Math.floor(Math.random() * greys.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
});

// 5. Wood Side (Bark) Texture
const woodSideTex = createPixelTexture((ctx, w, h) => {
  ctx.fillStyle = '#78350f';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#451a03';
  for (let x = 0; x < w; x += 3) {
    ctx.fillRect(x, 0, 1, h);
  }
  ctx.fillStyle = '#b45309';
  for (let y = 0; y < h; y += 4) {
    ctx.fillRect(0, y, w, 1);
  }
});

// 6. Wood Top (Rings) Texture
const woodTopTex = createPixelTexture((ctx, w, h) => {
  ctx.fillStyle = '#b45309';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 1;
  ctx.strokeRect(2, 2, 12, 12);
  ctx.strokeRect(5, 5, 6, 6);
});

// 7. Leaves Texture
const leavesTex = createPixelTexture((ctx, w, h) => {
  ctx.fillStyle = '#15803d';
  ctx.fillRect(0, 0, w, h);
  const greens = ['#166534', '#14532d', '#22c55e', '#4ade80'];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (Math.random() > 0.3) {
        ctx.fillStyle = greens[Math.floor(Math.random() * greens.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
});

export function getBlockMaterials(type: BlockType): THREE.Material[] | THREE.Material {
  switch (type) {
    case BlockType.GRASS: {
      const topMat = new THREE.MeshStandardMaterial({ map: grassTopTex, roughness: 0.7 });
      const sideMat = new THREE.MeshStandardMaterial({ map: grassSideTex, roughness: 0.8 });
      const bottomMat = new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 0.9 });
      // BoxGeometry faces order: +X, -X, +Y, -Y, +Z, -Z
      return [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat];
    }
    case BlockType.DIRT:
      return new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 0.9 });
    case BlockType.STONE:
      return new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.6, metalness: 0.1 });
    case BlockType.WOOD: {
      const sideMat = new THREE.MeshStandardMaterial({ map: woodSideTex, roughness: 0.8 });
      const topMat = new THREE.MeshStandardMaterial({ map: woodTopTex, roughness: 0.7 });
      return [sideMat, sideMat, topMat, topMat, sideMat, sideMat];
    }
    case BlockType.LEAVES:
      return new THREE.MeshStandardMaterial({ map: leavesTex, roughness: 0.5, transparent: true, opacity: 0.95 });
    default:
      return new THREE.MeshStandardMaterial({ color: 0xffffff });
  }
}
