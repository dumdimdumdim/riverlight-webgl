# Riverlight · WebGL

A standalone browser edition of the Riverlight Storybook kayak game. Paddle down an endless river, skirt islands, and watch for deer and birds along the banks.

```sh
cd kayak-webgl
npm ci
npm run check
npm run build
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open [localhost:4173](http://127.0.0.1:4173). The build in `dist/` is static, works from a subdirectory on a static host, and has no runtime dependencies or external assets. You can also open `dist/index.html` directly after building. Rendering requires WebGL 2.

Use **← / →**, the on-screen paddle buttons, or tap either side of the water. Alternate sides to keep moving forward. Tap the kayak icon in the top right to see time, distance, and strokes.

- `src/core.ts` keeps the physics and paddle animation from the Framer component.
- `src/game.ts` handles input, camera, terrain, geometry, and wildlife.
- `src/renderer.ts` batches geometry, renders a smaller mirrored scene for reflections, and renders the main scene with depth testing.
- `src/shaders.ts` defines the animated water, sky, light, and distance fog. Add `?debug` to inspect the running game with `window.riverlight.snapshot()`.

Trees use instanced procedural models. The kayak and paddler use curved surfaces with interpolated lighting. Reduced motion freezes the decorative water animation while keeping paddling playable.
