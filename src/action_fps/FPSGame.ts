import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export interface EnemyBot {
  id: string;
  mesh: THREE.Group;
  body: CANNON.Body;
  health: number;
  maxHealth: number;
  patrolStart: THREE.Vector3;
  patrolEnd: THREE.Vector3;
  direction: number; // 1 or -1
  speed: number;
  isAlive: boolean;
}

export interface ParticleEffect {
  mesh: THREE.Points;
  velocities: THREE.Vector3[];
  life: number;
  maxLife: number;
}

export interface ActionFPSState {
  timestamp: number;
  stepCount: number;
  player: {
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    health: number;
    ammo: { current: number; max: number; reserve: number; isReloading: boolean };
    score: number;
    wave: number;
    shotsFired: number;
    shotsHit: number;
    accuracy: number;
  };
  enemies: Array<{
    id: string;
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    health: number;
    isAlive: boolean;
  }>;
}

export class FPSGame {
  public scene: THREE.Scene;
  public world: CANNON.World;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public playerBody: CANNON.Body;

  // Gun & Camera
  public gunGroup: THREE.Group;
  public muzzleFlash: THREE.PointLight;
  public muzzleMesh: THREE.Mesh;
  public isLocked: boolean = false;

  // Gameplay State
  public health: number = 100;
  public currentAmmo: number = 30;
  public maxMagAmmo: number = 30;
  public reserveAmmo: number = 120;
  public isReloading: boolean = false;
  public score: number = 0;
  public wave: number = 1;
  public shotsFired: number = 0;
  public shotsHit: number = 0;

  public enemies: EnemyBot[] = [];
  public particles: ParticleEffect[] = [];
  private stepCount: number = 0;
  private animFrameId: number | null = null;
  private lastShootTime: number = 0;

  // WASD Movement
  private keys = { w: false, a: false, s: false, d: false, space: false };
  private pitch = 0;
  private yaw = 0;
  public container: HTMLElement;

  // Audio Context
  private audioCtx: AudioContext | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Scene Setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111827); // Dark tactical arena
    this.scene.fog = new THREE.FogExp2(0x111827, 0.02);

    // 2. Camera Setup
    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      500
    );

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

    container.appendChild(this.renderer.domElement);

    // 4. Physics Setup
    this.world = new CANNON.World();
    this.world.gravity.set(0, -18, 0);
    this.world.broadphase = new CANNON.NaiveBroadphase();

    // 5. Lighting
    this.setupLighting();

    // 6. Build Tactical Arena
    this.buildArena();

    // 7. Player Setup & Gun Model
    const playerShape = new CANNON.Box(new CANNON.Vec3(0.4, 0.9, 0.4));
    this.playerBody = new CANNON.Body({
      mass: 70,
      shape: playerShape,
      fixedRotation: true,
    });
    this.playerBody.position.set(0, 1.8, 15);
    this.world.addBody(this.playerBody);

    this.gunGroup = this.createGunModel();
    this.camera.add(this.gunGroup);
    this.scene.add(this.camera);

    // Muzzle Flash
    this.muzzleFlash = new THREE.PointLight(0xffaa22, 0, 8);
    this.muzzleFlash.position.set(0.28, -0.22, -0.9);
    this.camera.add(this.muzzleFlash);

    this.muzzleMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffea00, transparent: true, opacity: 0 })
    );
    this.muzzleMesh.position.set(0.28, -0.22, -0.9);
    this.camera.add(this.muzzleMesh);

    // 8. Spawn Enemies
    this.spawnWave(this.wave);

    // 9. Input & Pointer Lock Events
    this.setupEvents();

    // Loop
    this.animate(performance.now());
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0x64748b, 0.6);
    this.scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xf8fafc, 1.2);
    mainLight.position.set(15, 30, 10);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    this.scene.add(mainLight);

    // Red/Blue Tactical Accent Spotlights
    const spotRed = new THREE.SpotLight(0xef4444, 2.5, 30, Math.PI / 4);
    spotRed.position.set(-15, 12, -10);
    this.scene.add(spotRed);

    const spotBlue = new THREE.SpotLight(0x3b82f6, 2.5, 30, Math.PI / 4);
    spotBlue.position.set(15, 12, -10);
    this.scene.add(spotBlue);
  }

  private buildArena(): void {
    // Floor
    const floorSize = 50;
    const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.7,
      metalness: 0.2,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const floorBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
    });
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(floorBody);

    // Arena Perimeter Walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 });
    const wallHeight = 8;
    const wallPositions = [
      { pos: [0, wallHeight / 2, -floorSize / 2], size: [floorSize, wallHeight, 1] },
      { pos: [0, wallHeight / 2, floorSize / 2], size: [floorSize, wallHeight, 1] },
      { pos: [-floorSize / 2, wallHeight / 2, 0], size: [1, wallHeight, floorSize] },
      { pos: [floorSize / 2, wallHeight / 2, 0], size: [1, wallHeight, floorSize] },
    ];

    wallPositions.forEach((w) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]), wallMat);
      mesh.position.set(w.pos[0], w.pos[1], w.pos[2]);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scene.add(mesh);

      const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3(w.size[0] / 2, w.size[1] / 2, w.size[2] / 2)),
      });
      body.position.set(w.pos[0], w.pos[1], w.pos[2]);
      this.world.addBody(body);
    });

    // Tactical Cover Objects (Crates, Walls, Pillars)
    const coverLayout = [
      { x: -8, y: 1.5, z: 0, sx: 4, sy: 3, sz: 1.2, color: 0x475569 },
      { x: 8, y: 1.5, z: 0, sx: 4, sy: 3, sz: 1.2, color: 0x475569 },
      { x: 0, y: 1.2, z: -8, sx: 6, sy: 2.4, sz: 1.5, color: 0x64748b },
      { x: -12, y: 1.2, z: -10, sx: 2.5, sy: 2.4, sz: 2.5, color: 0x94a3b8 },
      { x: 12, y: 1.2, z: -10, sx: 2.5, sy: 2.4, sz: 2.5, color: 0x94a3b8 },
      { x: -5, y: 1.0, z: 8, sx: 2, sy: 2, sz: 2, color: 0xb91c1c }, // Red explosive crate
      { x: 5, y: 1.0, z: 8, sx: 2, sy: 2, sz: 2, color: 0x1d4ed8 }, // Blue supply crate
    ];

    coverLayout.forEach((c) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(c.sx, c.sy, c.sz),
        new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.5 })
      );
      mesh.position.set(c.x, c.y, c.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3(c.sx / 2, c.sy / 2, c.sz / 2)),
      });
      body.position.set(c.x, c.y, c.z);
      this.world.addBody(body);
    });
  }

  private createGunModel(): THREE.Group {
    const gun = new THREE.Group();
    // Gun position relative to camera view
    gun.position.set(0.28, -0.25, -0.45);

    const metalMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 });

    // Barrel
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.5), metalMat);
    barrel.position.set(0, 0.05, -0.25);
    gun.add(barrel);

    // Main Body Receiver
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.35), darkMat);
    body.position.set(0, 0, 0);
    gun.add(body);

    // Magazine
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.09), metalMat);
    mag.position.set(0, -0.12, 0.02);
    mag.rotation.x = -0.15;
    gun.add(mag);

    // Scope / Sight
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.08), metalMat);
    sight.position.set(0, 0.095, -0.05);
    gun.add(sight);

    return gun;
  }

  public spawnWave(waveNum: number): void {
    // Clear existing dead bots
    this.enemies.forEach((e) => {
      this.scene.remove(e.mesh);
      this.world.removeBody(e.body);
    });
    this.enemies = [];

    const botCount = 3 + waveNum * 2;
    for (let i = 0; i < botCount; i++) {
      const id = `bot_${waveNum}_${i + 1}`;

      const botGroup = new THREE.Group();
      // Torso
      const torso = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 1.1, 8),
        new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 }) // Tactical enemy red
      );
      torso.position.y = 0.55;
      torso.castShadow = true;
      botGroup.add(torso);

      // Head & Helmet
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.5 })
      );
      head.position.y = 1.35;
      head.castShadow = true;
      botGroup.add(head);

      // Visor
      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.1, 0.15),
        new THREE.MeshBasicMaterial({ color: 0x06b6d4 })
      );
      visor.position.set(0, 1.35, 0.15);
      botGroup.add(visor);

      // Spawn positions across arena cover zones
      const startX = (Math.random() - 0.5) * 32;
      const startZ = -5 - Math.random() * 15;
      botGroup.position.set(startX, 0.9, startZ);
      this.scene.add(botGroup);

      const shape = new CANNON.Box(new CANNON.Vec3(0.4, 0.9, 0.4));
      const body = new CANNON.Body({
        mass: 50,
        shape,
        fixedRotation: true,
      });
      body.position.set(startX, 0.9, startZ);
      this.world.addBody(body);

      const patrolDist = 6 + Math.random() * 6;
      this.enemies.push({
        id,
        mesh: botGroup,
        body,
        health: 60,
        maxHealth: 60,
        patrolStart: new THREE.Vector3(startX - patrolDist / 2, 0.9, startZ),
        patrolEnd: new THREE.Vector3(startX + patrolDist / 2, 0.9, startZ),
        direction: Math.random() < 0.5 ? 1 : -1,
        speed: 2.0 + waveNum * 0.3,
        isAlive: true,
      });
    }
  }

  private setupEvents(): void {
    const el = this.container;

    el.addEventListener('click', () => {
      if (!this.isLocked) {
        try {
          el.requestPointerLock();
        } catch {
          // ignore
        }
      } else {
        this.shoot();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === el;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      const sensitivity = 0.0022;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;
      this.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.pitch));
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'w' || e.key === 'W') this.keys.w = true;
      if (e.key === 's' || e.key === 'S') this.keys.s = true;
      if (e.key === 'a' || e.key === 'A') this.keys.a = true;
      if (e.key === 'd' || e.key === 'D') this.keys.d = true;
      if (e.key === ' ') this.keys.space = true;
      if (e.key === 'r' || e.key === 'R') this.reload();
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'w' || e.key === 'W') this.keys.w = false;
      if (e.key === 's' || e.key === 'S') this.keys.s = false;
      if (e.key === 'a' || e.key === 'A') this.keys.a = false;
      if (e.key === 'd' || e.key === 'D') this.keys.d = false;
      if (e.key === ' ') this.keys.space = false;
    });

    window.addEventListener('resize', this.onResize);
  }

  public shoot(): void {
    if (this.isReloading) return;
    const now = performance.now();
    if (now - this.lastShootTime < 120) return; // Fire rate limit (~500 RPM)

    if (this.currentAmmo <= 0) {
      this.reload();
      return;
    }

    this.lastShootTime = now;
    this.currentAmmo--;
    this.shotsFired++;

    // Muzzle Flash animation
    this.muzzleFlash.intensity = 3.5;
    (this.muzzleMesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
    setTimeout(() => {
      this.muzzleFlash.intensity = 0;
      (this.muzzleMesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }, 40);

    // Gun Recoil motion
    this.gunGroup.position.z = -0.38;
    this.gunGroup.rotation.x = 0.15;
    setTimeout(() => {
      this.gunGroup.position.z = -0.45;
      this.gunGroup.rotation.x = 0;
    }, 80);

    // Synthesize Gunshot Audio
    this.playGunshotSound();

    // Raycast Shooting Mechanics
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);

    const hitTargets: THREE.Object3D[] = [];
    this.enemies.forEach((e) => {
      if (e.isAlive) hitTargets.push(e.mesh);
    });

    const intersects = raycaster.intersectObjects(hitTargets, true);

    if (intersects.length > 0) {
      const hitPoint = intersects[0].point;
      this.shotsHit++;

      // Create spark particle hit effect
      this.createSparkEffect(hitPoint);

      // Find hit enemy
      const hitObj = intersects[0].object;
      const enemy = this.enemies.find((e) => {
        let curr: THREE.Object3D | null = hitObj;
        while (curr) {
          if (curr === e.mesh) return true;
          curr = curr.parent;
        }
        return false;
      });

      if (enemy && enemy.isAlive) {
        enemy.health -= 35; // 35 damage per shot
        this.score += 50;

        if (enemy.health <= 0) {
          enemy.isAlive = false;
          enemy.mesh.visible = false;
          this.world.removeBody(enemy.body);
          this.score += 200;

          // Check wave clearance
          const remaining = this.enemies.filter((e) => e.isAlive).length;
          if (remaining === 0) {
            this.wave++;
            setTimeout(() => this.spawnWave(this.wave), 1500);
          }
        }
      }
    }
  }

  public reload(): void {
    if (this.isReloading || this.currentAmmo === this.maxMagAmmo || this.reserveAmmo <= 0) return;

    this.isReloading = true;
    // Reload animation
    this.gunGroup.position.y = -0.45;

    setTimeout(() => {
      const needed = this.maxMagAmmo - this.currentAmmo;
      const reloadAmount = Math.min(needed, this.reserveAmmo);
      this.currentAmmo += reloadAmount;
      this.reserveAmmo -= reloadAmount;
      this.isReloading = false;
      this.gunGroup.position.y = -0.25;
    }, 1200);
  }

  private createSparkEffect(pos: THREE.Vector3): void {
    const count = 16;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;

      velocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 6,
          Math.random() * 5 + 1,
          (Math.random() - 0.5) * 6
        )
      );
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffaa00,
      size: 0.25,
      transparent: true,
      opacity: 0.9,
    });

    const sparkMesh = new THREE.Points(geo, mat);
    this.scene.add(sparkMesh);
    this.particles.push({ mesh: sparkMesh, velocities, life: 0, maxLife: 0.3 });
  }

  private playGunshotSound(): void {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {
      // Audio fallback silent
    }
  }

  public getState(): ActionFPSState {
    const accuracy = this.shotsFired > 0 ? Number(((this.shotsHit / this.shotsFired) * 100).toFixed(1)) : 0;
    const playerPos = this.playerBody.position;
    const playerVel = this.playerBody.velocity;

    return {
      timestamp: Date.now(),
      stepCount: this.stepCount,
      player: {
        position: { x: Number(playerPos.x.toFixed(2)), y: Number(playerPos.y.toFixed(2)), z: Number(playerPos.z.toFixed(2)) },
        velocity: { x: Number(playerVel.x.toFixed(2)), y: Number(playerVel.y.toFixed(2)), z: Number(playerVel.z.toFixed(2)) },
        health: this.health,
        ammo: { current: this.currentAmmo, max: this.maxMagAmmo, reserve: this.reserveAmmo, isReloading: this.isReloading },
        score: this.score,
        wave: this.wave,
        shotsFired: this.shotsFired,
        shotsHit: this.shotsHit,
        accuracy,
      },
      enemies: this.enemies.map((e) => ({
        id: e.id,
        position: { x: Number(e.body.position.x.toFixed(2)), y: Number(e.body.position.y.toFixed(2)), z: Number(e.body.position.z.toFixed(2)) },
        velocity: { x: Number(e.body.velocity.x.toFixed(2)), y: Number(e.body.velocity.y.toFixed(2)), z: Number(e.body.velocity.z.toFixed(2)) },
        health: e.health,
        isAlive: e.isAlive,
      })),
    };
  }

  public step(deltaMs: number = 16.666): ActionFPSState {
    const deltaSec = deltaMs / 1000;

    // Player WASD Physics movement
    const moveSpeed = 8.5;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const moveDir = new THREE.Vector3();

    if (this.keys.w) moveDir.add(forward);
    if (this.keys.s) moveDir.sub(forward);
    if (this.keys.d) moveDir.add(right);
    if (this.keys.a) moveDir.sub(right);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize().multiplyScalar(moveSpeed);
      this.playerBody.velocity.x = moveDir.x;
      this.playerBody.velocity.z = moveDir.z;
    } else {
      this.playerBody.velocity.x *= 0.8;
      this.playerBody.velocity.z *= 0.8;
    }

    if (this.keys.space && Math.abs(this.playerBody.velocity.y) < 0.1) {
      this.playerBody.velocity.y = 6.5; // Jump
    }

    // Step Cannon physics
    this.world.step(1 / 60, Math.min(deltaSec, 0.1), 3);

    // Sync Camera & Rotation
    this.camera.position.set(
      this.playerBody.position.x,
      this.playerBody.position.y + 0.6,
      this.playerBody.position.z
    );
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Enemy AI Tactical Patrol Movement
    this.enemies.forEach((e) => {
      if (!e.isAlive) return;

      const pos = e.body.position;
      pos.x += e.direction * e.speed * deltaSec;

      if (pos.x >= e.patrolEnd.x) {
        pos.x = e.patrolEnd.x;
        e.direction = -1;
      } else if (pos.x <= e.patrolStart.x) {
        pos.x = e.patrolStart.x;
        e.direction = 1;
      }

      e.mesh.position.copy(pos);
    });

    // Particle Animation
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += deltaSec;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }

      const posAttr = p.mesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < posAttr.count; k++) {
        posAttr.setX(k, posAttr.getX(k) + p.velocities[k].x * deltaSec);
        posAttr.setY(k, posAttr.getY(k) + p.velocities[k].y * deltaSec);
        posAttr.setZ(k, posAttr.getZ(k) + p.velocities[k].z * deltaSec);
      }
      posAttr.needsUpdate = true;
    }

    this.stepCount++;
    this.renderer.render(this.scene, this.camera);
    return this.getState();
  }

  private animate = (now: number): void => {
    this.animFrameId = requestAnimationFrame(this.animate);
    this.step(16.666);
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
