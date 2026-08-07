import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface ShireLantern {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  color: number;
  basePosition: THREE.Vector3;
}

export class ShireScene {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public controls: OrbitControls;
  public container: HTMLElement;

  private lanterns: ShireLantern[] = [];
  private fireflies: THREE.Points | null = null;
  private isWalkthrough: boolean = false;
  private moveState = { forward: false, backward: false, left: false, right: false };
  private yaw = 0;
  private pitch = 0;
  private walkPosition = new THREE.Vector3(0, 3, 25);
  private autoRotate: boolean = true;
  private animFrameId: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();

    // 1. Scene background & Fog
    this.scene.background = new THREE.Color(0x87ceeb); // Shire sky blue
    this.scene.fog = new THREE.FogExp2(0x9bd4e4, 0.008);

    // 2. Camera Setup
    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 12, 38);

    // 3. Renderer Setup
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      this.renderer = new THREE.WebGLRenderer({ antialias: false });
    }
    this.renderer.setSize(container.clientWidth || 1024, container.clientHeight || 768);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    container.appendChild(this.renderer.domElement);

    // 4. Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't go below ground
    this.controls.minDistance = 5;
    this.controls.maxDistance = 120;
    this.controls.target.set(0, 5, -5);

    // 5. Lighting
    this.setupLighting();

    // 6. Build Environment
    this.buildTerrain();
    this.buildBagEnd();
    this.buildPartyTree();
    this.buildLanterns();
    this.buildFencesAndDecorations();
    this.buildFireflies();

    // 7. Event Listeners
    window.addEventListener('resize', this.onResize);
    this.setupWalkthroughEvents();

    // Start loop
    this.animate(performance.now());
  }

  private setupLighting(): void {
    // Warm golden hour sunlight
    const sunLight = new THREE.DirectionalLight(0xfff3d1, 1.4);
    sunLight.position.set(40, 50, 30);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 150;
    const d = 45;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    this.scene.add(sunLight);

    // Ambient light with warm grass bounce
    const ambientLight = new THREE.AmbientLight(0xd4edd8, 0.7);
    this.scene.add(ambientLight);

    // Hemisphere light (sky blue / ground warm green)
    const hemiLight = new THREE.HemisphereLight(0xbfebff, 0x3d7a36, 0.5);
    this.scene.add(hemiLight);
  }

  private buildTerrain(): void {
    const size = 180;
    const segments = 120;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const posAttr = geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);

      // Rolling hill procedural displacement formula
      let y = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 3.5;
      y += Math.sin(x * 0.02 + 1.2) * 4.0;
      y += Math.cos(z * 0.03 - 0.8) * 3.0;

      // Flatten party lawn in center
      const distFromCenter = Math.sqrt(x * x + z * z);
      if (distFromCenter < 25) {
        const factor = distFromCenter / 25;
        y = y * (factor * factor);
      }

      posAttr.setY(i, y);
    }
    geometry.computeVertexNormals();

    const grassMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a9337,
      roughness: 0.8,
      metalness: 0.1,
      flatShading: true,
    });

    const terrain = new THREE.Mesh(geometry, grassMaterial);
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    // Stone pathway to Bag End
    this.buildPathway();
  }

  private buildPathway(): void {
    const pathPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const z = 20 - t * 35; // from z=20 to z=-15
      const x = Math.sin(t * Math.PI * 1.5) * 4; // slight S-curve path
      pathPoints.push(new THREE.Vector3(x, 0.15, z));
    }

    const pathCurve = new THREE.CatmullRomCurve3(pathPoints);
    const pathGeo = new THREE.TubeGeometry(pathCurve, 40, 1.2, 8, false);
    const pathMat = new THREE.MeshStandardMaterial({
      color: 0x9c8567, // earthy stone brown path
      roughness: 0.9,
    });
    const pathMesh = new THREE.Mesh(pathGeo, pathMat);
    pathMesh.scale.set(1, 0.1, 1);
    pathMesh.receiveShadow = true;
    this.scene.add(pathMesh);
  }

  private buildBagEnd(): void {
    const hillGroup = new THREE.Group();
    hillGroup.position.set(0, 0, -22);

    // The Bag End Mound Hill
    const moundGeo = new THREE.SphereGeometry(14, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.45);
    const moundMat = new THREE.MeshStandardMaterial({
      color: 0x3d7a2a, // lush hill green
      roughness: 0.8,
    });
    const mound = new THREE.Mesh(moundGeo, moundMat);
    mound.position.y = 0;
    mound.scale.set(1.5, 0.6, 1.2);
    mound.castShadow = true;
    mound.receiveShadow = true;
    hillGroup.add(mound);

    // Bag End Front Wall / Facade
    const wallGeo = new THREE.CylinderGeometry(5.5, 5.5, 4.5, 16, 1, false, Math.PI * 0.8, Math.PI * 0.4);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xe3d2b8, // warm cream stone/plaster
      roughness: 0.7,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 2.2, 5.2);
    wall.rotation.y = Math.PI;
    hillGroup.add(wall);

    // Bag End Famous Round Green Door
    const doorFrameGeo = new THREE.TorusGeometry(1.8, 0.25, 16, 32);
    const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.5 });
    const doorFrame = new THREE.Mesh(doorFrameGeo, doorFrameMat);
    doorFrame.position.set(0, 2.2, 5.4);
    hillGroup.add(doorFrame);

    const doorGeo = new THREE.CylinderGeometry(1.75, 1.75, 0.2, 32);
    doorGeo.rotateX(Math.PI / 2);
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x1e6b37, // Bilbo's classic green round door
      roughness: 0.4,
      metalness: 0.1,
    });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 2.2, 5.35);
    door.castShadow = true;
    hillGroup.add(door);

    // Brass Door Knob in center
    const knobGeo = new THREE.SphereGeometry(0.2, 16, 16);
    const knobMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 });
    const knob = new THREE.Mesh(knobGeo, knobMat);
    knob.position.set(0, 2.2, 5.5);
    hillGroup.add(knob);

    // Round Windows with warm glow
    const windowColors = [0xffd066, 0xffa033];
    [-3.2, 3.2].forEach((xOffset, idx) => {
      const winFrame = new THREE.Mesh(
        new THREE.TorusGeometry(0.8, 0.12, 12, 24),
        new THREE.MeshStandardMaterial({ color: 0x4a2e18 })
      );
      winFrame.position.set(xOffset, 2.5, 4.8);
      hillGroup.add(winFrame);

      const winGlass = new THREE.Mesh(
        new THREE.CircleGeometry(0.78, 16),
        new THREE.MeshBasicMaterial({ color: windowColors[idx] })
      );
      winGlass.position.set(xOffset, 2.5, 4.82);
      hillGroup.add(winGlass);

      // Window interior warm glow light
      const winLight = new THREE.PointLight(windowColors[idx], 1.5, 8);
      winLight.position.set(xOffset, 2.5, 5.5);
      hillGroup.add(winLight);
    });

    // Chimney atop Bag End
    const chimneyGeo = new THREE.BoxGeometry(0.9, 2.2, 0.9);
    const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x735c49, roughness: 0.9 });
    const chimney = new THREE.Mesh(chimneyGeo, chimneyMat);
    chimney.position.set(2, 6.5, -1);
    chimney.castShadow = true;
    hillGroup.add(chimney);

    // Smoke particles from chimney
    const smokeGroup = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const smokeP = new THREE.Mesh(
        new THREE.SphereGeometry(0.3 + i * 0.15, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.4 - i * 0.07 })
      );
      smokeP.position.set(2 + Math.sin(i) * 0.2, 7.8 + i * 0.6, -1);
      smokeGroup.add(smokeP);
    }
    hillGroup.add(smokeGroup);

    // Wooden Sign Post: "No Admittance Except on Party Business"
    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.8);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033 });
    const post = new THREE.Mesh(postGeo, woodMat);
    post.position.set(-2.5, 0.9, 10);
    hillGroup.add(post);

    const signGeo = new THREE.BoxGeometry(1.6, 0.8, 0.08);
    const signMat = new THREE.MeshStandardMaterial({ color: 0xd9c29c, roughness: 0.8 });
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(-2.5, 1.4, 10);
    sign.rotation.y = 0.2;
    hillGroup.add(sign);

    this.scene.add(hillGroup);
  }

  private buildPartyTree(): void {
    const treeGroup = new THREE.Group();
    treeGroup.position.set(12, 0, 5);

    // Trunk
    const trunkGeo = new THREE.CylinderGeometry(1.8, 2.8, 10, 12);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1b, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 5;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    treeGroup.add(trunk);

    // Major branches
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 1.1, 7, 8),
        trunkMat
      );
      branch.position.set(Math.cos(angle) * 1.5, 8.5, Math.sin(angle) * 1.5);
      branch.rotation.z = Math.cos(angle) * 0.6;
      branch.rotation.x = Math.sin(angle) * 0.6;
      branch.castShadow = true;
      treeGroup.add(branch);
    }

    // Lush Canopy Clusters
    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0x2d6a27,
      roughness: 0.7,
      flatShading: true,
    });

    const canopyPositions = [
      { x: 0, y: 13, z: 0, r: 8 },
      { x: -4, y: 12, z: 2, r: 6 },
      { x: 4, y: 12, z: -2, r: 6.5 },
      { x: 2, y: 14, z: 4, r: 5.5 },
      { x: -3, y: 13.5, z: -3, r: 6 },
      { x: 0, y: 16, z: 0, r: 5 },
    ];

    canopyPositions.forEach((cp) => {
      const folMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(cp.r, 2), foliageMat);
      folMesh.position.set(cp.x, cp.y, cp.z);
      folMesh.castShadow = true;
      treeGroup.add(folMesh);
    });

    this.scene.add(treeGroup);
  }

  private buildLanterns(): void {
    // Vibrant Bilbo Eleventy-First Birthday Party Lantern colors
    const colors = [
      0xff3366, // Vibrant Red/Pink
      0xffcc00, // Golden Yellow
      0x33ccff, // Cyan Blue
      0xaa33ff, // Magic Purple
      0xff6600, // Festive Orange
      0x33ff88, // Emerald Green
    ];

    const lanternPositions = [
      // Hanging under Party Tree
      new THREE.Vector3(8, 7.5, 4),
      new THREE.Vector3(15, 8.0, 7),
      new THREE.Vector3(10, 7.8, 8),
      new THREE.Vector3(14, 8.2, 2),
      new THREE.Vector3(6, 7.2, 6),
      // Along path & near Bag End
      new THREE.Vector3(-2, 2.5, 8),
      new THREE.Vector3(3, 2.5, 2),
      new THREE.Vector3(-1.8, 3.2, -15),
      new THREE.Vector3(1.8, 3.2, -15),
    ];

    lanternPositions.forEach((pos, idx) => {
      const color = colors[idx % colors.length];

      // Lantern Glass Mesh
      const glassGeo = new THREE.SphereGeometry(0.35, 12, 12);
      const glassMat = new THREE.MeshBasicMaterial({ color });
      const glassMesh = new THREE.Mesh(glassGeo, glassMat);
      glassMesh.position.copy(pos);

      // Top & bottom caps
      const capGeo = new THREE.CylinderGeometry(0.2, 0.25, 0.15, 8);
      const capMat = new THREE.MeshStandardMaterial({ color: 0x332211 });
      const topCap = new THREE.Mesh(capGeo, capMat);
      topCap.position.set(pos.x, pos.y + 0.22, pos.z);
      this.scene.add(topCap);

      // Point Light
      const light = new THREE.PointLight(color, 2.2, 12);
      light.position.copy(pos);
      this.scene.add(light);
      this.scene.add(glassMesh);

      this.lanterns.push({
        mesh: glassMesh,
        light,
        color,
        basePosition: pos.clone(),
      });
    });
  }

  private buildFencesAndDecorations(): void {
    // Wooden post fences around Party Lawn
    const fenceGroup = new THREE.Group();
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.8 });

    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 1.4 - 0.7; // arc around lawn
      const radius = 22;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;

      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4), woodMat);
      post.position.set(x, 0.7, z);
      post.castShadow = true;
      fenceGroup.add(post);

      if (i > 0) {
        const prevAngle = ((i - 1) / 16) * Math.PI * 1.4 - 0.7;
        const px = Math.sin(prevAngle) * radius;
        const pz = Math.cos(prevAngle) * radius;

        const dist = Math.sqrt((x - px) ** 2 + (z - pz) ** 2);
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, dist), woodMat);
        rail.position.set((x + px) / 2, 0.9, (z + pz) / 2);
        rail.rotation.y = Math.atan2(x - px, z - pz) + Math.PI / 2;
        rail.castShadow = true;
        fenceGroup.add(rail);
      }
    }
    this.scene.add(fenceGroup);

    // Colorful Flower Patches
    const flowerColors = [0xff4444, 0xffff44, 0xff88ff, 0x44ffff];
    for (let f = 0; f < 60; f++) {
      const fx = (Math.random() - 0.5) * 50;
      const fz = (Math.random() - 0.5) * 50;
      if (Math.abs(fx) < 3 && Math.abs(fz + 22) < 6) continue; // clear path

      const col = flowerColors[Math.floor(Math.random() * flowerColors.length)];
      const flower = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 6, 6),
        new THREE.MeshBasicMaterial({ color: col })
      );
      flower.position.set(fx, 0.2, fz);
      this.scene.add(flower);
    }
  }

  private buildFireflies(): void {
    const count = 80;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 1] = 1 + Math.random() * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffea78, // warm glowing yellow fireflies
      size: 0.35,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });

    this.fireflies = new THREE.Points(geometry, material);
    this.scene.add(this.fireflies);
  }

  private setupWalkthroughEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (!this.isWalkthrough) return;
      if (e.key === 'w' || e.key === 'W') this.moveState.forward = true;
      if (e.key === 's' || e.key === 'S') this.moveState.backward = true;
      if (e.key === 'a' || e.key === 'A') this.moveState.left = true;
      if (e.key === 'd' || e.key === 'D') this.moveState.right = true;
    });

    window.addEventListener('keyup', (e) => {
      if (!this.isWalkthrough) return;
      if (e.key === 'w' || e.key === 'W') this.moveState.forward = false;
      if (e.key === 's' || e.key === 'S') this.moveState.backward = false;
      if (e.key === 'a' || e.key === 'A') this.moveState.left = false;
      if (e.key === 'd' || e.key === 'D') this.moveState.right = false;
    });
  }

  public toggleWalkthrough(enable?: boolean): boolean {
    this.isWalkthrough = enable !== undefined ? enable : !this.isWalkthrough;
    this.controls.enabled = !this.isWalkthrough;
    if (this.isWalkthrough) {
      this.walkPosition.copy(this.camera.position);
    }
    return this.isWalkthrough;
  }

  public setAutoRotate(enable: boolean): void {
    this.autoRotate = enable;
    this.controls.autoRotate = enable;
    this.controls.autoRotateSpeed = 1.2;
  }

  private animate = (now: number): void => {
    this.animFrameId = requestAnimationFrame(this.animate);
    const time = now * 0.001;

    // 1. Lantern gentle sway and light pulsing
    this.lanterns.forEach((l, idx) => {
      const swayX = Math.sin(time * 1.5 + idx) * 0.15;
      const swayY = Math.cos(time * 2.0 + idx) * 0.08;
      l.mesh.position.set(l.basePosition.x + swayX, l.basePosition.y + swayY, l.basePosition.z);
      l.light.position.copy(l.mesh.position);
      l.light.intensity = 1.8 + Math.sin(time * 4 + idx) * 0.5;
    });

    // 2. Fireflies floating particle movement
    if (this.fireflies) {
      const posAttr = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i) + Math.sin(time * 2 + i) * 0.01;
        if (y < 0.5) y = 4;
        if (y > 10) y = 2;
        posAttr.setY(i, y);
        posAttr.setX(i, posAttr.getX(i) + Math.cos(time * 1.2 + i) * 0.008);
      }
      posAttr.needsUpdate = true;
    }

    // 3. Walkthrough position update
    if (this.isWalkthrough) {
      const speed = 0.25;
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      dir.y = 0;
      dir.normalize();

      const sideDir = new THREE.Vector3(-dir.z, 0, dir.x);

      if (this.moveState.forward) this.walkPosition.addScaledVector(dir, speed);
      if (this.moveState.backward) this.walkPosition.addScaledVector(dir, -speed);
      if (this.moveState.left) this.walkPosition.addScaledVector(sideDir, -speed);
      if (this.moveState.right) this.walkPosition.addScaledVector(sideDir, speed);

      this.camera.position.copy(this.walkPosition);
    } else {
      this.controls.update();
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  public destroy(): void {
    if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
