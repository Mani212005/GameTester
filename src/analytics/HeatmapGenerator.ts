import * as THREE from 'three';
import RBush from 'rbush';

export interface TelemetryPoint {
  x: number;
  y: number;
  z: number;
  severity: number; // 0.0 to 1.0 (0 = normal/info, 1.0 = critical defect)
}

export interface RBushItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  y: number;
  severity: number;
  index: number;
}

export class HeatmapGenerator {
  // 1. Pre-allocated Float32Array ring buffer for 40,000 floats (10,000 points * 4 attributes: x, y, z, severity)
  private readonly bufferCapacity: number = 10000;
  private readonly telemetryBuffer: Float32Array = new Float32Array(40000);
  private writeIndex: number = 0;
  private totalRecordedCount: number = 0;

  // 2. RBush 2D spatial index on ground plane (x, z)
  private spatialTree: RBush<RBushItem> = new RBush<RBushItem>();

  // 3. Three.js InstancedMesh visualization
  private scene: THREE.Scene | null = null;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private isVisible: boolean = false;
  private dummyMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private dummyColor: THREE.Color = new THREE.Color();

  constructor(scene?: THREE.Scene) {
    if (scene) {
      this.setScene(scene);
    }
  }

  public setScene(scene: THREE.Scene): void {
    this.scene = scene;
    this.initInstancedMesh();
  }

  private initInstancedMesh(): void {
    if (!this.scene || this.instancedMesh) return;

    const boxGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const boxMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      wireframe: false,
    });

    this.instancedMesh = new THREE.InstancedMesh(boxGeo, boxMat, this.bufferCapacity);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.count = 0;
    this.instancedMesh.visible = this.isVisible;
    this.scene.add(this.instancedMesh);
  }

  /**
   * Zero-allocation recording of a telemetry / defect point into ring buffer.
   */
  public addPoint(x: number, y: number, z: number, severity: number = 0.5): void {
    const slot = (this.writeIndex % this.bufferCapacity) * 4;
    this.telemetryBuffer[slot] = x;
    this.telemetryBuffer[slot + 1] = y;
    this.telemetryBuffer[slot + 2] = z;
    this.telemetryBuffer[slot + 3] = Math.max(0, Math.min(1, severity));

    this.writeIndex++;
    if (this.totalRecordedCount < this.bufferCapacity) {
      this.totalRecordedCount++;
    }

    this.rebuildSpatialIndex();
    this.updateInstancedMesh();
  }

  /**
   * Rebuild O(log N) RBush 2D spatial index for rapid range & density lookups on ground plane (x, z).
   */
  public rebuildSpatialIndex(): void {
    this.spatialTree.clear();
    const items: RBushItem[] = [];

    const count = this.getPointCount();
    for (let i = 0; i < count; i++) {
      const slot = i * 4;
      const x = this.telemetryBuffer[slot];
      const y = this.telemetryBuffer[slot + 1];
      const z = this.telemetryBuffer[slot + 2];
      const severity = this.telemetryBuffer[slot + 3];

      items.push({
        minX: x - 0.4,
        maxX: x + 0.4,
        minY: z - 0.4,
        maxY: z + 0.4,
        y,
        severity,
        index: i,
      });
    }

    this.spatialTree.load(items);
  }

  /**
   * Perform O(log N) spatial density & defect lookup for a bounding region on ground plane (x, z).
   */
  public querySpatialDensity(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number
  ): RBushItem[] {
    return this.spatialTree.search({
      minX,
      minY: minZ,
      maxX,
      maxY: maxZ,
    });
  }

  /**
   * Returns current active number of points stored in ring buffer.
   */
  public getPointCount(): number {
    return this.totalRecordedCount;
  }

  /**
   * Export all recorded telemetry data.
   */
  public getHeatmapData(): TelemetryPoint[] {
    const points: TelemetryPoint[] = [];
    const count = this.getPointCount();

    for (let i = 0; i < count; i++) {
      const slot = i * 4;
      points.push({
        x: Number(this.telemetryBuffer[slot].toFixed(3)),
        y: Number(this.telemetryBuffer[slot + 1].toFixed(3)),
        z: Number(this.telemetryBuffer[slot + 2].toFixed(3)),
        severity: Number(this.telemetryBuffer[slot + 3].toFixed(3)),
      });
    }

    return points;
  }

  /**
   * Updates Three.js InstancedMesh with glowing amber/red 3D defect boxes.
   */
  public updateInstancedMesh(): void {
    if (!this.instancedMesh) return;

    const count = this.getPointCount();
    this.instancedMesh.count = count;

    for (let i = 0; i < count; i++) {
      const slot = i * 4;
      const x = this.telemetryBuffer[slot];
      const y = this.telemetryBuffer[slot + 1];
      const z = this.telemetryBuffer[slot + 2];
      const severity = this.telemetryBuffer[slot + 3];

      // Matrix position
      this.dummyMatrix.setPosition(x, y + 0.4, z);
      this.instancedMesh.setMatrixAt(i, this.dummyMatrix);

      // Color interpolation: Low severity = Glowing Amber (0xf59e0b), High severity = Red (0xef4444)
      const amberColor = new THREE.Color(0xf59e0b);
      const redColor = new THREE.Color(0xef4444);
      this.dummyColor.copy(amberColor).lerp(redColor, severity);

      this.instancedMesh.setColorAt(i, this.dummyColor);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (this.instancedMesh) {
      this.instancedMesh.visible = visible;
    }
  }

  public toggleVisible(): boolean {
    this.setVisible(!this.isVisible);
    return this.isVisible;
  }

  public isHeatmapVisible(): boolean {
    return this.isVisible;
  }
}
