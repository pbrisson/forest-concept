import * as THREE from '../vendor/three/three.module.js';
// A static camera lets us stabilize subpixel foliage with a short history.
// Stabilize the tone-mapped frame, then add a localized sunset glow in the presentation pass.
export class ForestTemporal {
    width;
    height;
    current;
    history;
    valid = false;
    read = 0;
    scene = new THREE.Scene();
    camera = new THREE.Camera();
    geometry = new THREE.PlaneGeometry(2, 2);
    blend;
    copy;
    quad;
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.current = new THREE.FramebufferTexture(width, height);
        this.current.minFilter = this.current.magFilter = THREE.LinearFilter;
        this.history = [0, 1].map(() => new THREE.WebGLRenderTarget(width, height, {
            depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        }));
        const vertexShader = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
        this.blend = new THREE.ShaderMaterial({
            depthTest: false, depthWrite: false, toneMapped: false,
            uniforms: {
                currentFrame: { value: this.current }, previousFrame: { value: this.history[0].texture },
                texel: { value: new THREE.Vector2(1 / width, 1 / height) }, historyWeight: { value: 0 },
            },
            vertexShader,
            fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D currentFrame, previousFrame;
        uniform vec2 texel;
        uniform float historyWeight;
        void main() {
          vec3 current = texture2D(currentFrame, vUv).rgb;
          vec3 lo = current, hi = current;
          vec3 a = texture2D(currentFrame, vUv + vec2(texel.x, 0.)).rgb;
          vec3 b = texture2D(currentFrame, vUv - vec2(texel.x, 0.)).rgb;
          vec3 c = texture2D(currentFrame, vUv + vec2(0., texel.y)).rgb;
          vec3 d = texture2D(currentFrame, vUv - vec2(0., texel.y)).rgb;
          lo = min(lo, min(min(a,b), min(c,d)));
          hi = max(hi, max(max(a,b), max(c,d)));
          // Reject stale silhouettes instead of leaving trails behind moving branches.
          vec3 previous = clamp(texture2D(previousFrame, vUv).rgb, lo, hi);
          gl_FragColor = vec4(mix(current, previous, historyWeight), 1.);
        }
      `,
        });
        this.copy = new THREE.ShaderMaterial({
            depthTest: false, depthWrite: false, toneMapped: false,
            uniforms: { frame: { value: this.history[0].texture }, aspect: { value: width / height } }, vertexShader,
            fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D frame;
        uniform float aspect;
        void main() {
          vec3 color = texture2D(frame, vUv).rgb;
          // A broad amber veil and pale hot core recreate backlit photographic exposure.
          // This is added only at presentation, never accumulated into temporal history.
          vec2 source = vec2(.94, 1.04);
          vec2 spread = aspect < 1. ? vec2(.4, .3) : vec2(.4, .62);
          vec2 distance = (vUv - source) / spread;
          float veil = exp(-dot(distance, distance) * 1.6);
          vec2 coreDistance = (vUv - source) / (spread * .36);
          float core = exp(-dot(coreDistance, coreDistance) * 1.3);
          color = 1. - (1. - color) * exp(-vec3(1.45, .8, .29) * veil * .45);
          color = mix(color, vec3(1., .94, .72), core * .35);
          gl_FragColor = vec4(color, 1.);
        }
      `,
        });
        this.quad = new THREE.Mesh(this.geometry, this.blend);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
    }
    render(renderer, accumulate = true) {
        renderer.copyFramebufferToTexture(this.current);
        if (!accumulate) {
            this.copy.uniforms.frame.value = this.current;
            this.quad.material = this.copy;
            renderer.render(this.scene, this.camera);
            this.valid = false;
            return;
        }
        const write = 1 - this.read;
        this.blend.uniforms.previousFrame.value = this.history[this.read].texture;
        this.blend.uniforms.historyWeight.value = this.valid ? .68 : 0;
        this.quad.material = this.blend;
        renderer.setRenderTarget(this.history[write]);
        renderer.render(this.scene, this.camera);
        this.copy.uniforms.frame.value = this.history[write].texture;
        this.quad.material = this.copy;
        renderer.setRenderTarget(null);
        renderer.render(this.scene, this.camera);
        this.read = write;
        this.valid = true;
    }
    reset() { this.valid = false; }
    dispose() {
        this.current.dispose();
        this.history.forEach(target => target.dispose());
        this.geometry.dispose();
        this.blend.dispose();
        this.copy.dispose();
        this.scene.clear();
    }
}
