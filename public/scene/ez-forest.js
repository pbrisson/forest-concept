import * as THREE from '../vendor/three/three.module.js';
import { ForestTemporal } from './forest-temporal.js';
// Geometry is generated offline with EZ Tree; its generator/textures never enter the client bundle.
export class EzForest extends HTMLElement {
    renderer;
    temporal;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
    time = { value: 0 };
    frame = 0;
    last = 0;
    visible = false;
    loading = false;
    ready = false;
    failed = false;
    quality = 1;
    samples = 0;
    slow = 0;
    compact = matchMedia('(max-width: 767px), (pointer: coarse)').matches;
    motion = matchMedia('(prefers-reduced-motion: reduce)');
    events;
    observer;
    resizeObserver;
    geometries = [];
    materials = [];
    textures = [];
    progress = 0;
    downloaded = new Map();
    completed = false;
    loaderTimers = [];
    get loader() { return this.parentElement?.querySelector('[data-forest-loader]'); }
    setProgress(value) {
        this.progress = Math.max(this.progress, Math.min(100, Math.floor(value)));
        const loader = this.loader;
        if (!loader)
            return;
        loader.setAttribute('aria-valuenow', String(this.progress));
        loader.style.setProperty('--forest-progress', String(this.progress / 100));
        loader.querySelector('[data-forest-percent]').textContent = `${this.progress}%`;
    }
    finishLoading() {
        if (this.completed)
            return;
        this.completed = true;
        this.setProgress(100);
        this.loaderTimers.push(setTimeout(() => this.loader?.setAttribute('data-complete', ''), 650));
        this.loaderTimers.push(setTimeout(() => { if (this.loader)
            this.loader.hidden = true; }, 1050));
    }
    async fetchAsset(path, signal) {
        const response = await fetch(new URL(path, import.meta.url), { signal });
        if (!response.ok)
            throw new Error('Forest asset unavailable');
        // Decoded byte totals for the five versioned local assets; no synthetic timer-based progress.
        const total = this.compact ? 998683 : 1636791;
        const update = (bytes) => {
            this.downloaded.set(path, bytes);
            this.setProgress(88 * [...this.downloaded.values()].reduce((a, b) => a + b, 0) / total);
        };
        if (!response.body) {
            const data = await response.arrayBuffer();
            update(data.byteLength);
            return data;
        }
        const reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            chunks.push(value);
            bytes += value.byteLength;
            update(bytes);
        }
        const data = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return data.buffer;
    }
    async showPreparation(value) {
        this.setProgress(value);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (this.events?.signal.aborted)
            throw new Error('Disconnected');
    }
    connectedCallback() {
        this.events = new AbortController();
        const { signal } = this.events;
        this.observer = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; this.sync(); });
        this.observer.observe(this);
        this.resizeObserver = new ResizeObserver(() => { this.resize(); this.renderStill(); });
        this.resizeObserver.observe(this);
        document.addEventListener('visibilitychange', () => this.sync(), { signal });
        this.motion.addEventListener('change', () => { this.sync(); this.renderStill(); }, { signal });
        this.querySelector('canvas').addEventListener('webglcontextlost', event => {
            event.preventDefault();
            this.stop();
            this.failed = true;
            this.setAttribute('data-failed', '');
            this.removeAttribute('data-ready');
        }, { signal });
        this.querySelector('canvas').addEventListener('webglcontextrestored', () => {
            this.failed = false;
            this.removeAttribute('data-failed');
            this.renderStill();
            this.sync();
        }, { signal });
    }
    async loadModel(index, signal) {
        const data = await this.fetchAsset(`../assets/tree-${index}${this.compact ? '-low' : ''}.bin`, signal);
        const size = new DataView(data).getUint32(0, true);
        const fields = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 4, size)));
        return fields.map(model => {
            const geometry = new THREE.BufferGeometry();
            this.geometries.push(geometry);
            for (const name of ['position', 'normal', 'uv', 'index']) {
                const field = model[name];
                const offset = 4 + size + field.offset;
                const array = name === 'index' ? new Uint32Array(data, offset, field.count) : new Float32Array(data, offset, field.count);
                const attribute = new THREE.BufferAttribute(array, field.itemSize);
                if (name === 'index')
                    geometry.setIndex(attribute);
                else
                    geometry.setAttribute(name, attribute);
            }
            geometry.computeBoundingSphere();
            return geometry;
        });
    }
    windMaterial(map) {
        const material = new THREE.MeshLambertMaterial({
            map, color: map ? 0xffffff : 0x68624b, side: map ? THREE.DoubleSide : THREE.FrontSide,
            alphaTest: map ? .5 : 0,
            // Smooth cutout coverage across MSAA samples instead of switching each leaf-edge pixel on/off.
            alphaToCoverage: !!map && (this.renderer?.getContext().getParameter(this.renderer.getContext().SAMPLES) ?? 0) > 0,
        });
        material.onBeforeCompile = shader => {
            shader.uniforms.forestTime = this.time;
            shader.vertexShader = 'uniform float forestTime;\nvarying float crownLight;\nvarying vec3 canopyWorld;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vec3 root = instanceMatrix[3].xyz;
        float height = clamp(position.y / 48., 0., 1.);
        float phase = root.x * .07 + root.z * .045;
        float gust = sin(forestTime * .72 - phase) + .32 * sin(forestTime * 1.17 - phase * .8);
        transformed.x += pow(height, 1.7) * gust * 1.06;
        transformed.z += pow(height, 1.7) * gust * .48;
        ${map ? 'transformed.x += uv.y * .05 * sin(forestTime * 1.3 + position.x * .9 + position.z * .8 + phase);' : ''}
        crownLight = .55 + .45 * height;
        canopyWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;
      `);
            shader.fragmentShader = 'varying float crownLight;\nvarying vec3 canopyWorld;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nfloat leafTone = dot(diffuseColor.rgb, vec3(.299,.587,.114));\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(leafTone), .85);');
            shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= crownLight;');
            // Local sunset-orange aerial haze makes the sun's entry visible without a fullscreen blur/bloom pass.
            shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
        #include <fog_fragment>
        vec2 sunDistance = (canopyWorld.xz - vec2(88., -70.)) / vec2(75., 95.);
        float sunHaze = exp(-dot(sunDistance, sunDistance) * 1.25) * .46;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1., .56, .28), sunHaze);
      `);
        };
        material.customProgramCacheKey = () => map ? 'forest-leaf-sun-v2' : 'forest-bark-sun-v2';
        this.materials.push(material);
        return material;
    }
    makeLeafLitter(maps, trees) {
        // Bake once from the exact leaf sprites and tree positions; no per-frame ground work.
        const size = this.compact ? 1536 : 2048;
        const extent = 220;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#625638';
        ctx.fillRect(0, 0, size, size);
        const sprites = trees.map(tree => {
            const sprite = document.createElement('canvas');
            sprite.width = sprite.height = 192;
            const paint = sprite.getContext('2d');
            paint.drawImage(maps[tree.variant === 2 ? 1 : 0].image, 0, 0, 192, 192);
            const pixels = paint.getImageData(0, 0, 192, 192);
            const tint = tree.color.clone();
            // Fallen vermilion foliage should settle into copper/ochre rather than red islands.
            // Change only the ground tint; retain the brighter red crowns above it.
            const warmth = THREE.MathUtils.smoothstep(tint.r - tint.g, .16, .42);
            tint.lerp(new THREE.Color(0x9c8549), warmth * .85);
            tint.convertLinearToSRGB();
            for (let i = 0; i < pixels.data.length; i += 4) {
                const shade = .28 + .72 * (pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114) / 255;
                pixels.data[i] = 255 * tint.r * shade;
                pixels.data[i + 1] = 255 * tint.g * shade;
                pixels.data[i + 2] = 255 * tint.b * shade;
            }
            paint.putImageData(pixels, 0, 0);
            return sprite;
        });
        let seed = 71039;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        // Nearby crowns contribute most of the litter; scatter mixes their boundaries naturally.
        for (let i = 0; i < 30000; i++) {
            const x = random() * extent - extent / 2, z = random() * extent - extent / 2;
            const sourceX = x + (random() - .5) * 18, sourceZ = z + (random() - .5) * 18;
            let nearest = 0, distance = Infinity;
            trees.forEach((tree, index) => {
                const d = (tree.x - sourceX) ** 2 + (tree.z - sourceZ) ** 2;
                if (d < distance) {
                    distance = d;
                    nearest = index;
                }
            });
            const diameter = (i < 20000 ? 4 + random() * 3 : 2.8 + random() * 2.2) * size / extent;
            ctx.save();
            ctx.translate((x / extent + .5) * size, (z / extent + .5) * size);
            ctx.rotate(random() * Math.PI * 2);
            ctx.globalAlpha = 1;
            ctx.drawImage(sprites[nearest], -diameter / 2, -diameter / 2, diameter, diameter);
            ctx.restore();
        }
        // Baked contact shade anchors trunks without real-time shadow maps.
        for (const tree of trees) {
            const x = (tree.x / extent + .5) * size, y = (tree.z / extent + .5) * size;
            const radius = size / extent * 4;
            const shade = ctx.createRadialGradient(x, y, 0, x, y, radius);
            shade.addColorStop(0, 'rgba(35,30,15,.16)');
            shade.addColorStop(1, 'rgba(35,30,15,0)');
            ctx.fillStyle = shade;
            ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
        // Preserve recognizable leaf edges; mipmaps handle minification without baked blur.
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.anisotropy = Math.min(2, this.renderer.capabilities.getMaxAnisotropy());
        this.textures.push(texture);
        return texture;
    }
    async initialize() {
        this.loading = true;
        const signal = this.events.signal;
        try {
            this.renderer = new THREE.WebGLRenderer({ canvas: this.querySelector('canvas'), antialias: true, powerPreference: 'low-power', alpha: false });
            this.renderer.setPixelRatio(1);
            this.renderer.setClearColor(0x232a20);
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.3;
            const maps = await Promise.all(['oak', 'aspen'].map(async (name) => {
                const data = await this.fetchAsset(`../assets/${name}.png`, signal);
                const url = URL.createObjectURL(new Blob([data], { type: 'image/png' }));
                const image = new Image();
                image.src = url;
                try {
                    await image.decode();
                }
                finally {
                    URL.revokeObjectURL(url);
                }
                const texture = new THREE.Texture(image);
                texture.needsUpdate = true;
                if (signal.aborted) {
                    texture.dispose();
                    throw new Error('Disconnected');
                }
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.generateMipmaps = true;
                texture.anisotropy = Math.min(this.compact ? 2 : 4, this.renderer.capabilities.getMaxAnisotropy());
                this.textures.push(texture);
                return texture;
            }));
            const models = await Promise.all([0, 1, 2].map(index => this.loadModel(index, signal)));
            await this.showPreparation(90);
            this.scene.fog = new THREE.FogExp2(0x303a2b, .003);
            this.scene.add(new THREE.HemisphereLight(0xffe8c4, 0x233025, 1.8));
            const daylight = new THREE.DirectionalLight(0xffedcf, 1.2);
            daylight.position.set(65, 100, -35);
            this.scene.add(daylight);
            // A broad, feathered sun shaft enters from the upper-right of the canopy view.
            // Constant attenuation keeps this art-directed sunlight independent of scene scale.
            const sun = new THREE.SpotLight(0xff984f, 8, 300, Math.PI / 4, 1, 0);
            sun.position.set(95, 105, -90);
            sun.target.position.set(32, 8, -12);
            this.scene.add(sun, sun.target);
            const floorGeometry = new THREE.PlaneGeometry(220, 220);
            const floorMaterial = // A baked ambient floor keeps leaf detail visible even between deeply shaded crowns.
             new THREE.MeshBasicMaterial({ color: 0xa6a08d });
            this.geometries.push(floorGeometry);
            this.materials.push(floorMaterial);
            const floor = new THREE.Mesh(floorGeometry, floorMaterial);
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = -1;
            this.scene.add(floor);
            let seed = 94217;
            const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
            const columns = this.compact ? 5 : 9, rows = 8;
            // Normalize crown diameter before placement: the EZ Tree presets span 40–62 units.
            // Placing those directly on a 14-unit grid made several crowns occupy the same space.
            const diameters = models.map(([, leaves]) => {
                leaves.computeBoundingBox();
                const size = leaves.boundingBox.getSize(new THREE.Vector3());
                return Math.max(size.x, size.z);
            });
            const groups = [[], [], []];
            const groundTrees = [];
            const dummy = new THREE.Object3D();
            const palette = [0x7f9148, 0xa7a94a, 0xe4bc52, 0xc98235, 0xd05d46, 0x607d42];
            for (let row = 0; row < rows; row++)
                for (let col = 0; col < columns; col++) {
                    const x = (col - (columns - 1) / 2 + (row % 2 ? .25 : -.25)) * 18 + (random() - .5) * 5;
                    const z = (row - (rows - 1) / 2) * 18 + (random() - .5) * 5;
                    const variant = random() < .22 ? 2 : random() < .5 ? 0 : 1;
                    dummy.position.set(x, 1.5 * Math.sin(x * .05 + z * .03), z);
                    dummy.rotation.set(0, random() * Math.PI * 2, 0);
                    const scale = (28 + random() * 4) / diameters[variant];
                    dummy.scale.set(scale, scale * (.92 + random() * .16), scale);
                    dummy.updateMatrix();
                    // Weight the right canopy toward the gold and vermilion, keeping green variation.
                    const choices = x < -15 ? [0, 1, 5] : x > 8 ? [0, 2, 2, 3, 4, 4, 4, 5] : [0, 1, 2, 3, 4, 5];
                    const colorIndex = choices[Math.floor(random() * choices.length)];
                    const color = new THREE.Color(palette[colorIndex]);
                    color.multiplyScalar(x < -15 ? .65 : .95 + random() * .2);
                    groups[variant].push({ matrix: dummy.matrix.clone(), color });
                    groundTrees.push({ x, z, color, variant });
                }
            await this.showPreparation(93);
            floorMaterial.map = this.makeLeafLitter(maps, groundTrees);
            floorMaterial.needsUpdate = true;
            models.forEach((model, index) => {
                model.forEach((geometry, part) => {
                    const material = this.windMaterial(part ? maps[index === 2 ? 1 : 0] : undefined);
                    const mesh = new THREE.InstancedMesh(geometry, material, groups[index].length);
                    groups[index].forEach(({ matrix, color }, i) => {
                        mesh.setMatrixAt(i, matrix);
                        mesh.setColorAt(i, part ? color : new THREE.Color(0xc6b394));
                    });
                    mesh.instanceMatrix.needsUpdate = true;
                    if (mesh.instanceColor)
                        mesh.instanceColor.needsUpdate = true;
                    mesh.computeBoundingSphere();
                    this.scene.add(mesh);
                });
            });
            this.dataset.trees = String(columns * rows);
            await this.showPreparation(97);
            this.ready = true;
            this.resize();
            this.renderStill();
        }
        catch (error) {
            if (!signal.aborted) {
                this.failed = true;
                this.setAttribute('data-failed', '');
                this.dispose();
                const fallback = this.parentElement?.querySelector('[data-forest-fallback]');
                try {
                    await fallback?.decode();
                    if (!signal.aborted)
                        this.finishLoading();
                }
                catch {
                    if (this.loader)
                        this.loader.hidden = true;
                }
            }
        }
        finally {
            this.loading = false;
            if (signal.aborted)
                this.dispose();
            else
                this.sync();
        }
    }
    resize() {
        if (!this.renderer)
            return;
        const { width, height } = this.getBoundingClientRect();
        if (!width || !height)
            return;
        const ratio = Math.min(1, Math.sqrt((this.compact ? 400000 : 1400000) / (width * height))) * this.quality;
        const renderWidth = Math.round(width * ratio), renderHeight = Math.round(height * ratio);
        this.renderer.setSize(renderWidth, renderHeight, false);
        if (!this.temporal || this.temporal.width !== renderWidth || this.temporal.height !== renderHeight) {
            this.temporal?.dispose();
            this.temporal = new ForestTemporal(renderWidth, renderHeight);
        }
        this.temporal.reset();
        const viewHeight = Math.min(112, 160 / (width / height));
        this.camera.left = -viewHeight * width / height / 2;
        this.camera.right = -this.camera.left;
        this.camera.top = viewHeight / 2;
        this.camera.bottom = -viewHeight / 2;
        this.camera.position.set(0, 155, 65);
        this.camera.lookAt(0, 10, 0);
        this.camera.updateProjectionMatrix();
    }
    renderStill() {
        if (!this.ready || this.failed || !this.renderer || !this.isConnected || !this.visible || document.hidden)
            return;
        this.renderer.render(this.scene, this.camera);
        this.temporal?.render(this.renderer, !this.motion.matches);
        this.setAttribute('data-ready', '');
        this.finishLoading();
    }
    sync() {
        if (!this.isConnected || !this.visible || document.hidden || this.failed) {
            this.stop();
            return;
        }
        if (!this.ready && !this.loading) {
            void this.initialize();
            return;
        }
        if (this.motion.matches) {
            this.stop();
            this.renderStill();
            return;
        }
        if (this.ready && !this.frame)
            this.frame = requestAnimationFrame(this.draw);
    }
    draw = (now) => {
        this.frame = requestAnimationFrame(this.draw);
        const elapsed = now - this.last;
        if (elapsed < 1000 / 30 - 1)
            return;
        if (this.last) {
            this.time.value += Math.min(elapsed / 1000, .1);
            this.samples++;
            if (elapsed > 55)
                this.slow++;
            if (this.samples >= 90) {
                if (this.slow > 25 && this.quality > .8) {
                    this.quality = .8;
                    this.resize();
                }
                this.samples = this.slow = 0;
            }
        }
        this.last = now;
        this.renderStill();
    };
    stop() { cancelAnimationFrame(this.frame); this.frame = 0; this.last = 0; this.temporal?.reset(); }
    dispose() {
        this.stop();
        this.temporal?.dispose();
        this.temporal = undefined;
        this.geometries.forEach(g => g.dispose());
        this.materials.forEach(m => m.dispose());
        this.textures.forEach(t => t.dispose());
        this.renderer?.dispose();
        this.renderer = undefined;
        this.geometries = [];
        this.materials = [];
        this.textures = [];
        this.scene.clear();
        this.ready = false;
    }
    disconnectedCallback() {
        this.events?.abort();
        this.loaderTimers.forEach(clearTimeout);
        this.observer?.disconnect();
        this.resizeObserver?.disconnect();
        this.dispose();
    }
}
if (!customElements.get('ez-forest'))
    customElements.define('ez-forest', EzForest);
