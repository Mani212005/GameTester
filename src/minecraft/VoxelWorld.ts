import * as THREE from 'three';
import { BlockType, BLOCK_DEFINITIONS, Vector3D, VoxelWorldState } from './types';
import { createTextureAtlas } from './textures';

const CHUNK_SIZE = 16;
const CHUNK_SIZE_Y = 32;

class Chunk {
  blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE_Y * CHUNK_SIZE);
  mesh?: THREE.Mesh;
  dirty = true;
  x: number;
  z: number;

  constructor(x: number, z: number) {
    this.x = x;
    this.z = z;
  }

  getIndex(lx: number, ly: number, lz: number) {
    return lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
  }
}

export class VoxelWorld {
  public scene: THREE.Scene;
  private chunks = new Map<string, Chunk>();
  private atlas: { texture: THREE.CanvasTexture, uvs: Record<number, number[]> };
  private material: THREE.MeshStandardMaterial;

  public minX = -32;
  public maxX = 31;
  public minZ = -32;
  public maxZ = 31;
  public minY = 0;
  public maxY = 31;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.atlas = createTextureAtlas();
    this.material = new THREE.MeshStandardMaterial({
      map: this.atlas.texture,
      roughness: 0.8,
      transparent: true,
      alphaTest: 0.1
    });

    this.generateTerrain();
    this.rebuildWorld();
  }

  getChunk(cx: number, cz: number) {
    const key = `${cx},${cz}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  public getBlock(x: number, y: number, z: number): BlockType {
    if (y < 0 || y >= CHUNK_SIZE_Y) return BlockType.AIR;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    const chunk = this.chunks.get(`${cx},${cz}`);
    if (!chunk) return BlockType.AIR;
    return chunk.blocks[chunk.getIndex(lx, y, lz)];
  }

  public setBlock(x: number, y: number, z: number, type: BlockType): boolean {
    if (y < 0 || y >= CHUNK_SIZE_Y) return false;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    const chunk = this.getChunk(cx, cz);
    chunk.blocks[chunk.getIndex(lx, y, lz)] = type;
    chunk.dirty = true;
    
    // Neighbor dirty flags
    if (lx === 0) { const c = this.chunks.get(`${cx-1},${cz}`); if (c) c.dirty = true; }
    if (lx === CHUNK_SIZE - 1) { const c = this.chunks.get(`${cx+1},${cz}`); if (c) c.dirty = true; }
    if (lz === 0) { const c = this.chunks.get(`${cx},${cz-1}`); if (c) c.dirty = true; }
    if (lz === CHUNK_SIZE - 1) { const c = this.chunks.get(`${cx},${cz+1}`); if (c) c.dirty = true; }

    this.rebuildWorld();
    return true;
  }

  private generateTerrain(): void {
    for (let x = this.minX; x <= this.maxX; x++) {
      for (let z = this.minZ; z <= this.maxZ; z++) {
        const heightOffset = Math.floor(Math.sin(x * 0.3) * Math.cos(z * 0.3) * 1.5);
        const surfaceY = 6 + heightOffset;

        for (let y = this.minY; y <= surfaceY; y++) {
          if (y <= 3) this.setBlock(x, y, z, BlockType.STONE);
          else if (y < surfaceY) this.setBlock(x, y, z, BlockType.DIRT);
          else this.setBlock(x, y, z, BlockType.GRASS);
        }
        // Fill water
        for (let y = surfaceY + 1; y <= 5; y++) {
          this.setBlock(x, y, z, BlockType.WATER);
        }
      }
    }
    // Tree 1
    this.addTree(5, 7, 5);
    this.addTree(-7, 7, -6);
    this.addTree(8, 7, -8);
    this.addTree(-6, 7, 8);
  }

  private addTree(trunkX: number, startY: number, trunkZ: number): void {
    for (let y = startY; y < startY + 4; y++) this.setBlock(trunkX, y, trunkZ, BlockType.WOOD);
    const leafY = startY + 3;
    for (let lx = trunkX - 2; lx <= trunkX + 2; lx++) {
      for (let lz = trunkZ - 2; lz <= trunkZ + 2; lz++) {
        for (let ly = leafY; ly <= leafY + 2; ly++) {
          if (Math.abs(lx - trunkX) === 2 && Math.abs(lz - trunkZ) === 2 && ly === leafY + 2) continue;
          if (this.getBlock(lx, ly, lz) === BlockType.AIR) {
            this.setBlock(lx, ly, lz, BlockType.LEAVES);
          }
        }
      }
    }
  }

  public rebuildWorld(): void {
    for (const chunk of this.chunks.values()) {
      if (chunk.dirty) {
        this.buildChunkMesh(chunk);
        chunk.dirty = false;
      }
    }
  }

  private buildChunkMesh(chunk: Chunk) {
    if (chunk.mesh) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunk.mesh = undefined;
    }

    // Greedy meshing
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let indexOffset = 0;

    const CHUNK_DIMS = [CHUNK_SIZE, CHUNK_SIZE_Y, CHUNK_SIZE];
    
    // Axes: 0: X, 1: Y, 2: Z
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      const x = [0, 0, 0];
      const q = [0, 0, 0];
      const mask = new Int32Array(CHUNK_DIMS[u] * CHUNK_DIMS[v]);
      const maskBlock = new Int32Array(CHUNK_DIMS[u] * CHUNK_DIMS[v]);
      q[axis] = 1;

      for (x[axis] = -1; x[axis] < CHUNK_DIMS[axis]; ) {
        let n = 0;
        for (x[v] = 0; x[v] < CHUNK_DIMS[v]; ++x[v]) {
          for (x[u] = 0; x[u] < CHUNK_DIMS[u]; ++x[u]) {
            const block0 = x[axis] >= 0 ? chunk.blocks[chunk.getIndex(x[0], x[1], x[2])] : BlockType.AIR;
            const block1 = x[axis] < CHUNK_DIMS[axis] - 1 ? chunk.blocks[chunk.getIndex(x[0] + q[0], x[1] + q[1], x[2] + q[2])] : BlockType.AIR;
            
            let b0Solid = block0 !== BlockType.AIR;
            let b1Solid = block1 !== BlockType.AIR;
            // Water culls water, leaves cull leaves, but solid vs transparent
            if (block0 === block1 && block0 !== BlockType.AIR) { b0Solid = false; b1Solid = false; }
            if (b0Solid && !b1Solid) {
              mask[n] = 1; // Face looking positive
              maskBlock[n] = block0;
            } else if (!b0Solid && b1Solid) {
              mask[n] = -1; // Face looking negative
              maskBlock[n] = block1;
            } else {
              mask[n] = 0;
              maskBlock[n] = 0;
            }
            n++;
          }
        }
        ++x[axis];
        n = 0;
        for (let j = 0; j < CHUNK_DIMS[v]; ++j) {
          for (let i = 0; i < CHUNK_DIMS[u]; ) {
            const c = mask[n];
            const blockType = maskBlock[n];
            if (c !== 0) {
              let w = 1;
              while (i + w < CHUNK_DIMS[u] && mask[n + w] === c && maskBlock[n + w] === blockType) {
                w++;
              }
              let h = 1;
              let done = false;
              for (; j + h < CHUNK_DIMS[v]; h++) {
                for (let k = 0; k < w; k++) {
                  if (mask[n + k + h * CHUNK_DIMS[u]] !== c || maskBlock[n + k + h * CHUNK_DIMS[u]] !== blockType) {
                    done = true;
                    break;
                  }
                }
                if (done) break;
              }
              
              x[u] = i;
              x[v] = j;
              const du = [0, 0, 0];
              const dv = [0, 0, 0];
              du[u] = w;
              dv[v] = h;

              const xA = x[0], yA = x[1], zA = x[2];
              const xB = xA + du[0], yB = yA + du[1], zB = zA + du[2];
              const xC = xB + dv[0], yC = yB + dv[1], zC = zB + dv[2];
              const xD = xA + dv[0], yD = yA + dv[1], zD = zA + dv[2];

              // Normal and face mapping
              let nx = 0, ny = 0, nz = 0;
              let faceIndex = 0;
              if (axis === 0) { nx = c; faceIndex = c > 0 ? 0 : 1; }
              if (axis === 1) { ny = c; faceIndex = c > 0 ? 2 : 3; }
              if (axis === 2) { nz = c; faceIndex = c > 0 ? 4 : 5; }

              const uvsArr = this.atlas.uvs[blockType] || this.atlas.uvs[BlockType.DIRT];
              const uvIdx = uvsArr[faceIndex];
              const uvMin = uvIdx / 10.0; // 10 textures total
              const uvMax = (uvIdx + 1) / 10.0;
              const eps = 0.001; // fix bleeding

              if (c > 0) {
                positions.push(xA, yA, zA, xB, yB, zB, xC, yC, zC, xD, yD, zD);
                indices.push(indexOffset, indexOffset + 1, indexOffset + 2, indexOffset, indexOffset + 2, indexOffset + 3);
                uvs.push(0, uvMin+eps, w, uvMin+eps, w, uvMax-eps, 0, uvMax-eps);
              } else {
                positions.push(xA, yA, zA, xD, yD, zD, xC, yC, zC, xB, yB, zB);
                indices.push(indexOffset, indexOffset + 1, indexOffset + 2, indexOffset, indexOffset + 2, indexOffset + 3);
                uvs.push(0, uvMin+eps, 0, uvMax-eps, w, uvMax-eps, w, uvMin+eps);
              }

              for(let k = 0; k < 4; k++) normals.push(nx, ny, nz);
              indexOffset += 4;

              for (let l = 0; l < h; ++l) {
                for (let k = 0; k < w; ++k) {
                  mask[n + k + l * CHUNK_DIMS[u]] = 0;
                }
              }
              i += w;
              n += w;
            } else {
              i++;
              n++;
            }
          }
        }
      }
    }

    if (positions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.set(chunk.x * CHUNK_SIZE, 0, chunk.z * CHUNK_SIZE);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      chunk.mesh = mesh;
    }
  }

  public getVoxelState(): VoxelWorldState {
    const counts: Record<string, number> = {};
    for (const chunk of this.chunks.values()) {
      for (let i = 0; i < chunk.blocks.length; i++) {
        const t = chunk.blocks[i];
        if (t !== BlockType.AIR) {
          const name = BLOCK_DEFINITIONS[t as BlockType] ? BLOCK_DEFINITIONS[t as BlockType].name : 'Unknown';
          counts[name] = (counts[name] || 0) + 1;
        }
      }
    }
    return {
      totalBlocks: Object.values(counts).reduce((a, b) => a + b, 0),
      blockCounts: counts,
      bounds: {
        min: { x: this.minX, y: this.minY, z: this.minZ },
        max: { x: this.maxX, y: this.maxY, z: this.maxZ },
      },
    };
  }

  public raycastVoxel(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number = 6) {
    const dir = direction.clone().normalize();
    const stepSize = 0.05;
    let current = origin.clone();
    let prev = current.clone();

    for (let d = 0; d < maxDistance; d += stepSize) {
      current.addScaledVector(dir, stepSize);
      const vx = Math.floor(current.x);
      const vy = Math.floor(current.y);
      const vz = Math.floor(current.z);
      const blockType = this.getBlock(vx, vy, vz);
      
      if (blockType !== BlockType.AIR && blockType !== BlockType.WATER) {
        const px = Math.floor(prev.x);
        const py = Math.floor(prev.y);
        const pz = Math.floor(prev.z);
        return {
          hit: true,
          blockPos: { x: vx, y: vy, z: vz },
          blockType,
          placePos: { x: px, y: py, z: pz },
        };
      }
      prev.copy(current);
    }
    return { hit: false };
  }

  public updateLiquids(): void {
    let liquidUpdated = false;
    // Iterate over chunks and propagate water down and sideways
    const newWater: {x: number, y: number, z: number}[] = [];
    for (let x = this.minX; x <= this.maxX; x++) {
      for (let z = this.minZ; z <= this.maxZ; z++) {
        for (let y = this.minY; y <= this.maxY; y++) {
          if (this.getBlock(x, y, z) === BlockType.WATER) {
            // flow down
            if (this.getBlock(x, y - 1, z) === BlockType.AIR) {
              newWater.push({x, y: y - 1, z});
            } else if (this.getBlock(x, y - 1, z) !== BlockType.AIR && this.getBlock(x, y - 1, z) !== BlockType.WATER) {
              // flow sideways
              if (this.getBlock(x + 1, y, z) === BlockType.AIR) newWater.push({x: x + 1, y, z});
              if (this.getBlock(x - 1, y, z) === BlockType.AIR) newWater.push({x: x - 1, y, z});
              if (this.getBlock(x, y, z + 1) === BlockType.AIR) newWater.push({x, y, z: z + 1});
              if (this.getBlock(x, y, z - 1) === BlockType.AIR) newWater.push({x, y, z: z - 1});
            }
          }
        }
      }
    }
    for (const w of newWater) {
      if (this.getBlock(w.x, w.y, w.z) === BlockType.AIR) {
        this.setBlock(w.x, w.y, w.z, BlockType.WATER);
        liquidUpdated = true;
      }
    }
  }

}
