# Working agreements

- Communicate with the user in French.
- Write all project documentation in English.
- Write all code comments in English.
- Write commit messages in English, without AI attribution or AI co-author trailers. Use the configured Git author identity.

## Project conventions

- Keep this project dependency-free apart from the vendored Three.js browser modules.
- Keep browser code in public/scene, assets in public/assets, and third-party modules in public/vendor.
- Preserve bundled third-party license notices.
- Run npm run check after changing JavaScript, and verify the served page after changing the scene.
