import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Chart, ChartNote } from '../core/chart';
import type { Grade } from '../core/judge';
import { makeGlowTexture, Particles, Snow } from './fx';
import { isAccidental, pitchColor, STAGE_BACKGROUND } from '../../../shared/pitch-palette';

const MAX_LANES = 8;
/** Ring outline on sharps/flats (strike target and gems), so colour is never the only cue. */
const ACCIDENTAL_RING = '#f4f4ff';

export interface RenderOptions {
  bloom: boolean;
  /** Force a drawing-buffer size (e.g. 3840×2160) regardless of window size. */
  fixedWidth?: number;
  fixedHeight?: number;
  maxPixelRatio: number;
  msaa: number;
  particles: boolean;
  /** Size the drawing buffer from the canvas' CSS box instead of the window (several highways per page). */
  fitCanvas?: boolean;
  /** With fitCanvas: frame the view for at least this many lanes, so highways with fewer lanes match. */
  fitLanes?: number;
}

const HIGHWAY_VS = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const HIGHWAY_FS = /* glsl */ `
uniform float uSongTime;
uniform float uSpeed;
uniform float uBeatLen;
uniform float uLaneWidth;
uniform float uLanes;
uniform float uFire;
uniform float uGlow[${MAX_LANES}];
uniform vec3 uColors[${MAX_LANES}];
varying vec3 vWorld;
void main() {
  float halfW = uLanes * uLaneWidth * 0.5;
  float laneF = (vWorld.x + halfW) / uLaneWidth;
  int lane = int(clamp(floor(laneF), 0.0, uLanes - 1.0));
  float inLane = fract(laneF);
  float dist = -vWorld.z;
  vec3 laneCol = uColors[lane];

  vec3 col = vec3(0.012, 0.012, 0.035) + laneCol * 0.035;
  // Alternate lane shading.
  col *= mod(float(lane), 2.0) < 0.5 ? 1.0 : 0.75;

  // Lane dividers.
  float dl = min(inLane, 1.0 - inLane) * uLaneWidth;
  col += vec3(0.35, 0.4, 0.6) * (1.0 - smoothstep(0.01, 0.045, dl)) * 0.35;

  // Beat / bar lines scrolling with song time.
  float t = uSongTime + dist / uSpeed;
  float beat = t / uBeatLen;
  float bf = fract(beat);
  float d = min(bf, 1.0 - bf) * uBeatLen * uSpeed;
  float isBar = mod(floor(beat + 0.5), 4.0) < 0.5 ? 1.0 : 0.0;
  float line = 1.0 - smoothstep(0.02, 0.07 + 0.05 * isBar, d);
  col += vec3(0.5, 0.55, 0.8) * line * (0.18 + 0.4 * isBar) * step(0.0, t);

  // Press beam up the lane.
  float g = uGlow[lane];
  col += laneCol * g * 0.6 * (1.0 - smoothstep(0.0, 14.0, dist)) * (0.6 + 0.4 * sin(inLane * 3.14159));

  // Strike zone band.
  col += vec3(0.9, 0.9, 1.0) * (1.0 - smoothstep(0.0, 0.35, abs(dist))) * 0.25;

  // Glowing side rails; turn to fire at max multiplier.
  float edge = halfW - abs(vWorld.x);
  float rail = 1.0 - smoothstep(0.0, 0.1, edge);
  vec3 railCol = mix(vec3(0.45, 0.6, 1.4), vec3(2.6, 0.9, 0.15), uFire);
  float flicker = 0.85 + 0.15 * sin(dist * 1.3 - uSongTime * 14.0) * uFire;
  col += railCol * rail * 1.6 * flicker;

  // Fire wash near edges.
  col += vec3(1.0, 0.35, 0.05) * uFire * (1.0 - smoothstep(0.0, 1.2, edge)) * 0.25 * (1.0 - smoothstep(0.0, 30.0, dist));

  float fade = 1.0 - smoothstep(22.0, 48.0, dist);
  col *= fade;
  if (dist < -0.6) col *= 0.4;
  gl_FragColor = vec4(col, 1.0);
}`;

function bellGeometry(): THREE.BufferGeometry {
  const pts = [
    [0.0, 0.0], [0.58, 0.0], [0.6, 0.04], [0.52, 0.14], [0.42, 0.3], [0.33, 0.52], [0.28, 0.72],
    [0.2, 0.88], [0.08, 0.95], [0.07, 1.18], [0.13, 1.24], [0.0, 1.3],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 28);
  g.translate(0, -0.1, 0);
  return g;
}

export class HighwayRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly gpu: string;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 200);
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass | null = null;
  private readonly particles: Particles;
  private readonly snow: Snow;
  private readonly glowTex: THREE.Texture;
  private readonly highwayMat: THREE.ShaderMaterial;
  private highway: THREE.Mesh | null = null;
  private gems: THREE.InstancedMesh | null = null;
  private halos: THREE.InstancedMesh | null = null;
  private rims: THREE.InstancedMesh | null = null;
  private laneGroup = new THREE.Group();
  private notes: ChartNote[] = [];
  private hidden = new Uint8Array(0);
  private first = 0;
  private laneCount = 0;
  private laneColors: THREE.Color[] = [];
  private laneAccidental: boolean[] = [];
  private targetMats: THREE.MeshBasicMaterial[] = [];
  private targets: THREE.Mesh[] = [];
  private waves: THREE.Mesh[] = [];
  private flashes: THREE.Sprite[] = [];
  private glow = new Float32Array(MAX_LANES);
  private flash = new Float32Array(MAX_LANES);
  private wave = new Float32Array(MAX_LANES);
  private fire = 0;
  private fireTarget = 0;
  private kick = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();
  readonly laneWidth = 1.5;
  speed = 13;
  lookAhead = 3.2;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly opts: RenderOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));

    this.scene.background = new THREE.Color('#05040d');
    this.scene.fog = new THREE.Fog('#05040d', 30, 70);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#a8b8ff', '#1a0820', 0.6));
    const key = new THREE.DirectionalLight('#fff4e0', 1.6);
    key.position.set(3, 8, 6);
    this.scene.add(key);

    this.camera.position.set(0, 5.4, 8.6);
    this.camera.lookAt(0, 0, -9);

    this.glowTex = makeGlowTexture();
    this.highwayMat = new THREE.ShaderMaterial({
      vertexShader: HIGHWAY_VS,
      fragmentShader: HIGHWAY_FS,
      uniforms: {
        uSongTime: { value: 0 },
        uSpeed: { value: this.speed },
        uBeatLen: { value: 0.5 },
        uLaneWidth: { value: this.laneWidth },
        uLanes: { value: 1 },
        uFire: { value: 0 },
        uGlow: { value: new Array<number>(MAX_LANES).fill(0) },
        uColors: { value: Array.from({ length: MAX_LANES }, () => new THREE.Color(STAGE_BACKGROUND)) },
      },
    });

    this.particles = new Particles(opts.particles ? 4000 : 1);
    this.scene.add(this.particles.points);
    this.snow = new Snow(opts.particles ? 1400 : 0, this.glowTex);
    this.scene.add(this.snow.points);
    this.scene.add(this.laneGroup);

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: opts.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (opts.bloom) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.82);
      this.composer.addPass(this.bloomPass);
    }
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  /** Scroll speed (world units per song second) and how many seconds ahead notes appear. */
  setScroll(speed: number, lookAhead: number): void {
    this.speed = speed;
    this.lookAhead = lookAhead;
    this.highwayMat.uniforms.uSpeed.value = speed;
  }

  setChart(chart: Chart): void {
    this.laneCount = chart.lanes.length;
    // Colour follows the bell's pitch class, never its lane index.
    this.laneColors = chart.lanes.map((l) => new THREE.Color(pitchColor(l.pitch)));
    this.laneAccidental = chart.lanes.map((l) => isAccidental(l.pitch));
    const uColors = this.highwayMat.uniforms.uColors.value as THREE.Color[];
    uColors.forEach((c, i) => c.copy(this.laneColors[i] ?? new THREE.Color(STAGE_BACKGROUND)));
    this.notes = chart.notes;
    this.hidden = new Uint8Array(chart.notes.length);
    this.first = 0;
    this.highwayMat.uniforms.uLanes.value = this.laneCount;
    this.highwayMat.uniforms.uBeatLen.value = 60 / chart.bpm;
    this.updateFov();

    this.laneGroup.clear();
    this.gems?.dispose();
    this.halos?.dispose();
    this.rims?.dispose();
    this.targets = [];
    this.targetMats = [];
    this.waves = [];
    this.flashes = [];

    const width = this.laneCount * this.laneWidth;
    this.highway = new THREE.Mesh(new THREE.PlaneGeometry(width, 70).rotateX(-Math.PI / 2), this.highwayMat);
    this.highway.position.z = -70 / 2 + 3;
    this.laneGroup.add(this.highway);

    const ringGeo = new THREE.TorusGeometry(0.52, 0.055, 12, 48).rotateX(-Math.PI / 2);
    const discGeo = new THREE.CircleGeometry(0.48, 40).rotateX(-Math.PI / 2);
    const waveGeo = new THREE.RingGeometry(0.5, 0.62, 48).rotateX(-Math.PI / 2);
    const outerGeo = new THREE.TorusGeometry(0.66, 0.03, 8, 48).rotateX(-Math.PI / 2);
    const outerMat = new THREE.MeshBasicMaterial({ color: ACCIDENTAL_RING });
    for (let i = 0; i < this.laneCount; i++) {
      const x = this.laneX(i);
      const color = this.laneColors[i];
      const mat = new THREE.MeshBasicMaterial({ color: color.clone() });
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.position.set(x, 0.03, 0);
      this.laneGroup.add(ring);
      if (this.laneAccidental[i]) {
        const outer = new THREE.Mesh(outerGeo, outerMat);
        outer.position.set(x, 0.03, 0);
        this.laneGroup.add(outer);
      }
      this.targets.push(ring);
      this.targetMats.push(mat);
      const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.12) }));
      disc.position.set(x, 0.02, 0);
      this.laneGroup.add(disc);
      const wave = new THREE.Mesh(
        waveGeo,
        new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      wave.position.set(x, 0.05, 0);
      this.laneGroup.add(wave);
      this.waves.push(wave);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTex, color: color.clone().multiplyScalar(2.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      sprite.position.set(x, 0.5, 0);
      this.laneGroup.add(sprite);
      this.flashes.push(sprite);
    }

    const count = Math.max(1, chart.notes.length);
    const gemMat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.7, roughness: 0.22, envMapIntensity: 1.4, side: THREE.DoubleSide });
    this.gems = new THREE.InstancedMesh(bellGeometry(), gemMat, count);
    this.gems.frustumCulled = false;
    const haloMat = new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.2, 2.2), haloMat, count);
    this.halos.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      const lane = chart.notes[i]?.lane ?? 0;
      const c = this.laneColors[lane] ?? new THREE.Color('#fff');
      this.gems.setColorAt(i, c);
      this.halos.setColorAt(i, this.tmpColor.copy(c).multiplyScalar(0.9));
    }
    this.gems.count = 0;
    this.halos.count = 0;
    // Ring outline around sharp/flat gems (flat on the highway, around the bell's mouth).
    const rimCount = Math.max(1, chart.notes.filter((n) => this.laneAccidental[n.lane]).length);
    this.rims = new THREE.InstancedMesh(new THREE.TorusGeometry(0.7, 0.05, 8, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ACCIDENTAL_RING }), rimCount);
    this.rims.frustumCulled = false;
    this.rims.count = 0;
    this.laneGroup.add(this.halos, this.gems, this.rims);
  }

  laneX(i: number): number {
    return (i - (this.laneCount - 1) / 2) * this.laneWidth;
  }

  press(lane: number): void {
    this.glow[lane] = 1;
  }

  hit(noteId: number, lane: number, grade: Grade): void {
    if (noteId >= 0 && noteId < this.hidden.length) this.hidden[noteId] = 1;
    const color = this.laneColors[lane];
    if (!color) return;
    const strength = grade === 'perfect' ? 1 : grade === 'great' ? 0.75 : 0.5;
    this.flash[lane] = strength;
    this.wave[lane] = 1;
    this.kick = Math.max(this.kick, 0.4 * strength);
    const x = this.laneX(lane);
    this.particles.spawn(x, 0.3, 0, color, Math.round(40 * strength + 10 * this.fire), 5, 4.5, 0.3, 0.9, 2.2);
    if (grade === 'perfect') this.particles.spawn(x, 0.4, 0, new THREE.Color('#ffffff'), 12, 2.5, 7, 0.18, 0.7, 3);
  }

  miss(noteId: number, lane: number): void {
    if (noteId >= 0 && noteId < this.hidden.length) this.hidden[noteId] = 1;
    this.particles.spawn(this.laneX(lane), 0.1, 0.2, new THREE.Color('#552222'), 8, 1.5, 1, 0.25, 0.5, 1);
  }

  setFire(level: number): void {
    this.fireTarget = level;
  }

  /** Renders the scene as it should look at `songTime`. */
  frame(songTime: number, dt: number, wall: number): void {
    const decay = Math.exp(-dt * 7);
    for (let i = 0; i < this.laneCount; i++) {
      this.glow[i] *= Math.exp(-dt * 9);
      this.flash[i] *= decay;
      this.wave[i] *= Math.exp(-dt * 4);
      const m = this.targetMats[i];
      m.color.copy(this.laneColors[i]).multiplyScalar(0.7 + this.glow[i] * 2 + this.flash[i] * 5);
      const s = 1 + 0.18 * this.flash[i] + 0.1 * this.glow[i];
      this.targets[i].scale.set(s, 1, s);
      const w = this.waves[i];
      const ws = 1 + (1 - this.wave[i]) * 1.8;
      w.scale.set(ws, 1, ws);
      (w.material as THREE.MeshBasicMaterial).opacity = this.wave[i] * this.wave[i];
      const f = this.flashes[i];
      f.material.opacity = this.flash[i];
      const fs = 1.2 + this.flash[i] * 3.2;
      f.scale.set(fs, fs, 1);
    }
    this.fire += (this.fireTarget - this.fire) * Math.min(1, dt * 3);
    const u = this.highwayMat.uniforms;
    u.uSongTime.value = songTime;
    u.uFire.value = this.fire;
    const glowArr = u.uGlow.value as number[];
    for (let i = 0; i < MAX_LANES; i++) glowArr[i] = Math.max(this.glow[i], this.flash[i]);

    if (this.fire > 0.05 && this.opts.particles) {
      const halfW = (this.laneCount * this.laneWidth) / 2;
      const n = Math.random() < this.fire * 0.9 ? 2 : 0;
      for (let k = 0; k < n; k++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.particles.spawn(side * halfW, 0.1, -Math.random() * 12, new THREE.Color('#ff7a1a'), 1, 0.4, 3.5, 0.35, 1.0, 2.5);
      }
    }

    this.updateNotes(songTime, wall);
    this.particles.update(dt);
    this.snow.update(dt, wall);

    this.kick *= Math.exp(-dt * 10);
    this.camera.position.y = 5.4 - this.kick * 0.12;
    this.composer.render(dt);
  }

  private updateNotes(songTime: number, wall: number): void {
    const gems = this.gems;
    const halos = this.halos;
    const rims = this.rims;
    if (!gems || !halos || !rims) return;
    const notes = this.notes;
    while (this.first < notes.length && notes[this.first].time < songTime - 0.5) this.first++;
    const camQ = this.camera.quaternion;
    let n = 0;
    let nr = 0;
    for (let i = this.first; i < notes.length; i++) {
      const note = notes[i];
      const dtNote = note.time - songTime;
      if (dtNote > this.lookAhead) break;
      if (this.hidden[i]) continue;
      const z = -dtNote * this.speed;
      const x = this.laneX(note.lane);
      const appear = Math.min(1, (this.lookAhead - dtNote) * 2.5);
      const s = 0.95 * appear;
      this.dummy.position.set(x, 0.05, z);
      this.dummy.rotation.set(-0.25, 0, Math.sin(wall * 5 + i) * 0.12);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();
      gems.setMatrixAt(n, this.dummy.matrix);
      gems.setColorAt(n, this.laneColors[note.lane]);
      if (this.laneAccidental[note.lane] && nr < rims.instanceMatrix.count) {
        this.dummy.position.set(x, 0.04, z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(s, s, s);
        this.dummy.updateMatrix();
        rims.setMatrixAt(nr++, this.dummy.matrix);
      }
      this.dummy.position.set(x, 0.45, z);
      this.dummy.quaternion.copy(camQ);
      const hs = s * (dtNote < 0 ? 0.6 : 1);
      this.dummy.scale.set(hs, hs, hs);
      this.dummy.updateMatrix();
      halos.setMatrixAt(n, this.dummy.matrix);
      halos.setColorAt(n, this.tmpColor.copy(this.laneColors[note.lane]).multiplyScalar(0.55));
      n++;
    }
    gems.count = n;
    halos.count = n;
    rims.count = nr;
    gems.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    rims.instanceMatrix.needsUpdate = true;
    if (gems.instanceColor) gems.instanceColor.needsUpdate = true;
    if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
  }

  resize(): void {
    const { fixedWidth, fixedHeight } = this.opts;
    let w: number, h: number, pr: number;
    if (fixedWidth && fixedHeight) {
      w = fixedWidth;
      h = fixedHeight;
      pr = 1;
    } else if (this.opts.fitCanvas) {
      w = Math.max(1, this.canvas.clientWidth);
      h = Math.max(1, this.canvas.clientHeight);
      pr = Math.min(window.devicePixelRatio || 1, this.opts.maxPixelRatio);
    } else {
      w = window.innerWidth;
      h = window.innerHeight;
      pr = Math.min(window.devicePixelRatio || 1, this.opts.maxPixelRatio);
    }
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.updateFov();
    this.particles.setPixelScale(h * pr);
  }

  private updateFov(): void {
    const aspect = this.camera.aspect;
    if (this.opts.fitCanvas) {
      // Widen the view until every lane (plus a margin) fits at the strike line, ~10.15 units away.
      const halfW = (Math.max(1, this.laneCount, this.opts.fitLanes ?? 0) * this.laneWidth) / 2 + 0.6;
      const vHalf = Math.atan(halfW / 10.15 / aspect);
      this.camera.fov = Math.max(48, (2 * vHalf * 180) / Math.PI);
    } else {
      // Keep all lanes visible on narrow screens.
      this.camera.fov = aspect < 1.2 ? 62 : 48;
    }
    this.camera.updateProjectionMatrix();
  }

  get bufferSize(): { width: number; height: number } {
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return { width: v.x, height: v.y };
  }

  /** CSS-pixel positions of each lane's strike target (for DOM labels). */
  laneScreenPositions(): { x: number; y: number }[] {
    const rect = this.canvas.getBoundingClientRect();
    const out: { x: number; y: number }[] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < this.laneCount; i++) {
      v.set(this.laneX(i), 0, 0.85).project(this.camera);
      out.push({ x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height });
    }
    return out;
  }
}
