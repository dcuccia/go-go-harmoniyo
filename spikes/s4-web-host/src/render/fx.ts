import * as THREE from 'three';

export function makeGlowTexture(size = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.65)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PARTICLE_VS = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FS = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  if (a <= 0.001) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

/** Pooled additive point particles, simulated on the CPU. */
export class Particles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private next = 0;
  private readonly material: THREE.ShaderMaterial;
  gravity = -9;

  constructor(private readonly max = 4000) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -20), 100);
    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      uniforms: { uScale: { value: 400 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setPixelScale(heightPx: number): void {
    this.material.uniforms.uScale.value = heightPx * 0.5;
  }

  spawn(x: number, y: number, z: number, color: THREE.Color, count: number, speed = 6, up = 4, size = 0.25, life = 0.8, intensity = 2): void {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = Math.cos(a) * s;
      this.vel[i * 3 + 1] = up * (0.5 + Math.random());
      this.vel[i * 3 + 2] = Math.sin(a) * s * 0.6;
      const tint = 0.6 + Math.random() * 0.4;
      this.col[i * 3] = Math.min(1, color.r * tint + 0.25) * intensity;
      this.col[i * 3 + 1] = Math.min(1, color.g * tint + 0.25) * intensity;
      this.col[i * 3 + 2] = Math.min(1, color.b * tint + 0.25) * intensity;
      this.maxLife[i] = this.life[i] = life * (0.5 + Math.random() * 0.5);
      this.baseSize[i] = size * (0.5 + Math.random());
    }
  }

  update(dt: number): void {
    const g = this.gravity * dt;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] += g;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t;
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
  }
}

/** Gently falling snow in a box around the stage (holiday theme). */
export class Snow {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly drift: Float32Array;

  constructor(count: number, tex: THREE.Texture) {
    this.pos = new Float32Array(count * 3);
    this.drift = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * 80;
      this.pos[i * 3 + 1] = Math.random() * 30 - 4;
      this.pos[i * 3 + 2] = -Math.random() * 80 + 5;
      this.drift[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size: 0.18,
      map: tex,
      color: new THREE.Color(0.75, 0.82, 1.0),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  update(dt: number, t: number): void {
    const n = this.drift.length;
    for (let i = 0; i < n; i++) {
      this.pos[i * 3 + 1] -= dt * (0.6 + (i % 7) * 0.08);
      this.pos[i * 3] += Math.sin(t * 0.7 + this.drift[i]) * dt * 0.3;
      if (this.pos[i * 3 + 1] < -4) this.pos[i * 3 + 1] += 30;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
