import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BlockType, BLOCK_DEFINITIONS, Vector3D, VoxelWorldState } from './types';

export class VoxelWorld {
  public scene: THREE.Scene;
  public cannonWorld: CANNON.World;
  private blocks: Map<string, BlockType> = new Map();
  private instancedMeshes: Map<BlockType, THREE.InstancedMesh> = new Map();
  private cannonBodies: Map<string, CANNON.Body> = new Map();
  
  // World bounds
  public readonly minX = -16;
  public readonly maxX = 15;
  public readonly minZ = -16;
  public readonly maxZ = 15;
  public readonly minY = 0;
  public readonly maxY = 16;

  private dummyObject = new THREE.Object3D();
  private cannonMaterial: CANNON.Material;

  constructor(scene: THREE.Scene, cannonWorld: CANNON.World, cannonMaterial: CANNON.Material) {
    this.scene = scene;
    this.cannonWorld = cannonWorld;
    this.cannonMaterial = cannonMaterial;
    this.generateTerrain();
    this.rebuildWorld();
  }

  private getKey(x: number, y: number, z: number): string {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  }

  public parseKey(key: string): Vector3D {
    const [x, y, z] = key.split(',').map(Number);
    return { x, y, z };
  }

  public getBlock(x: number, y: number, z: number): BlockType {
    const key = this.getKey(x, y, z);
    return this.blocks.get(key) ?? BlockType.AIR;
  }

  public setBlock(x: number, y: number, z: number, type: BlockType): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    if (ix < this.minX || ix > this.maxX || iz < this.minZ || iz > this.maxZ || iy < this.minY || iy > this.maxY) {
      return false;
    }

    const key = this.getKey(ix, iy, iz);
    if (type === BlockType.AIR) {
      this.blocks.delete(key);
    } else {
      this.blocks.set(key, type);
    }

    this.rebuildWorld();
    return true;
  }

  private generateTerrain(): void {
    this.blocks.clear();

    for (let x = this.minX; x <= this.maxX; x++) {
      for (let z = this.minZ; z <= this.maxZ; z++) {
        // Simple heightmap with trig variation
        const heightOffset = Math.floor(Math.sin(x * 0.3) * Math.cos(z * 0.3) * 1.5);
        const surfaceY = 6 + heightOffset;

        for (let y = this.minY; y <= surfaceY; y++) {
          if (y <= 3) {
            this.blocks.set(this.getKey(x, y, z), BlockType.STONE);
          } else if (y < surfaceY) {
            this.blocks.set(this.getKey(x, y, z), BlockType.DIRT);
          } else {
            this.blocks.set(this.getKey(x, y, z), BlockType.GRASS);
          }
        }
      }
    }

    // Add decorative trees
    this.addTree(5, 7, 5);
    this.addTree(-7, 7, -6);
    this.addTree(8, 7, -8);
    this.addTree(-6, 7, 8);
  }

  private addTree(trunkX: number, startY: number, trunkZ: number): void {
    // Trunk
    for (let y = startY; y < startY + 4; y++) {
      this.blocks.set(this.getKey(trunkX, y, trunkZ), BlockType.WOOD);
    }
    // Leaves canopy
    const leafY = startY + 3;
    for (let lx = trunkX - 2; lx <= trunkX + 2; lx++) {
      for (let lz = trunkZ - 2; lz <= trunkZ + 2; lz++) {
        for (let ly = leafY; ly <= leafY + 2; ly++) {
          if (Math.abs(lx - trunkX) === 2 && Math.abs(lz - trunkZ) === 2 && ly === leafY + 2) continue;
          if (this.getBlock(lx, ly, lz) === BlockType.AIR) {
            this.blocks.set(this.getKey(lx, ly, lz), BlockType.LEAVES);
          }
        }
      }
    }
  }

  public rebuildWorld(): void {
    // 1. Remove existing instanced meshes from Three.js scene
    this.instancedMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    });
    this.instancedMeshes.clear();

    // 2. Remove existing Cannon physics bodies
    this.cannonBodies.forEach((body) => {
      this.cannonWorld.removeBody(body);
    });
    this.cannonBodies.clear();

    // Group positions by block type
    const positionsByType = new Map<BlockType, Vector3D[]>();
    this.blocks.forEach((type, key) => {
      if (type === BlockType.AIR) return;
      if (!positionsByType.has(type)) {
        positionsByType.set(type, []);
      }
      const pos = this.parseKey(key);
      positionsByType.get(type)!.push(pos);

      // Create physics body for solid block
      const def = BLOCK_DEFINITIONS[type];
      if (def && def.solid) {
        const boxShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
        const body = new CANNON.Body({
          mass: 0, // static
          shape: boxShape,
          material: this.cannonMaterial,
        });
        body.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
        this.cannonWorld.addBody(body);
        this.cannonBodies.set(key, body);
      }
    });

    // Create instanced meshes for rendering
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

    positionsByType.forEach((positions, type) => {
      const def = BLOCK_DEFINITIONS[type];
      const material = new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: 0.6,
        metalness: 0.1,
      });

      const instancedMesh = new THREE.InstancedMesh(boxGeometry, material, positions.length);
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;

      positions.forEach((pos, idx) => {
        this.dummyObject.position.set(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
        this.dummyObject.updateMatrix();
        instancedMesh.setMatrixAt(idx, this.dummyObject.matrix);
      });

      instancedMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(instancedMesh);
      this.instancedMeshes.set(type, instancedMesh);
    });
  }

  public getVoxelState(): VoxelWorldState {
    const counts: Record<string, number> = {};
    let total = 0;

    this.blocks.forEach((type) => {
      const def = BLOCK_DEFINITIONS[type];
      const name = def ? def.name : 'Unknown';
      counts[name] = (counts[name] || 0) + 1;
      total++;
    });

    return {
      totalBlocks: total,
      blockCounts: counts,
      bounds: {
        min: { x: this.minX, y: this.minY, z: this.minZ },
        max: { x: this.maxX, y: this.maxY, z: this.maxZ },
      },
    };
  }

  // Raycasting helper for voxel interaction
  public raycastVoxel(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number = 6
  ): {
    hit: boolean;
    blockPos?: Vector3D;
    blockType?: BlockType;
    placePos?: Vector3D;
  } {
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
      if (blockType !== BlockType.AIR) {
        // Hit a block!
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
}
