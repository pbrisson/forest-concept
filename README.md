# Forest Concept

An isolated copy of the animated forest and its percentage loader. Includes wind animation, canopy lighting, temporal stabilization, desktop/mobile tree geometry, adaptive rendering, reduced-motion support, and a static image fallback.

## Run

Install Node.js 20 or newer, copy this entire directory anywhere, then run:

```sh
node server.mjs
```

Open http://localhost:8080. `npm start` is an equivalent convenience command. No `npm install`, build step, environment file, CDN, or connection to the original website is needed.

The server listens on all interfaces by default. Configure `HOST` and `PORT` through environment variables, for example on Linux:

```sh
HOST=127.0.0.1 PORT=9000 node server.mjs
```

For a public deployment, run this process with your usual service manager and reverse proxy. The server serves only `public/`. You can also serve `public/` directly using any static HTTP server, including under a URL subdirectory. Opening the HTML with `file://` is unsupported because the scene fetches geometry.

## Reuse

- `public/index.html`: scene container, fallback image, and loader markup.
- `public/scene/forest.css`: standalone appearance and loader styles. Set `.forest-scene` height to fit an embedded section.
- `public/scene/ez-forest.js`: native custom element, geometry loading, wind, lighting, and rendering.
- `public/scene/forest-temporal.js`: frame stabilization and sunlight presentation.
- `public/assets/`: only the tree models, leaf textures, fallback images, and asset license.
- `public/vendor/three/`: Three.js 0.186.1 browser modules and MIT license.

Preserve the relative layout of `scene/`, `assets/`, and `vendor/` when copying. Keep the fallback, custom element, and loader as siblings within the scene container. Asset URLs resolve relative to the scene module. The element sets `data-ready` after its first render and `data-failed` if WebGL or loading fails. A failure reveals the static fallback; reduced motion renders a still forest.

Three.js is the only third-party runtime library and is bundled locally as two unmodified browser modules. The Node server uses built-in modules only. The tree geometry is already generated; the EZ Tree generator is unnecessary at runtime. Preserve the bundled Three.js and EZ Tree MIT notices when redistributing.

This directory contains no Astro, React, wallet, database, navigation, website content, or package installation dependencies. Its JavaScript is directly editable; the original TypeScript is not required.

## Repository layout

```text
public/
  assets/       Tree geometry, textures, fallback images, and asset license
  scene/        Forest rendering, animation, and styles
  vendor/       Bundled Three.js modules and license
server.mjs      Static development server
package.json    Runtime requirements and convenience scripts
AGENTS.md       Project working agreements
```

## Development

Run `npm run check` to validate the application JavaScript syntax. There is no build step or automated browser test suite. After visual changes, open the application and verify the loader, animated scene, and reduced-motion fallback in a browser.

Documentation, code comments, and commit messages must be in English. User discussions are in French. Commits use the configured Git identity without AI attribution or AI co-author trailers.
