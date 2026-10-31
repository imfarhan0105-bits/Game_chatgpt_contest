# ChatGPT Sites handoff

Use this project as the source for the existing Nocturna multiplayer game.

## Required behavior to preserve

- Keep the existing game UI, maps, controls, movement, aiming, shooting, roles, room codes, round rules, and room lifecycle exactly as implemented.
- Do not replace multiplayer with local-only state, polling, simulated players, or a different game implementation.
- Multiple players on separate devices must join the same room and receive synchronized state through the existing WebSocket protocol.
- Preserve the server-authoritative room and match logic in `server.js`, including unique five-letter room codes and removal of a room after all players disconnect.
- Do not change Barcelona, Paris, Muscat, or Miami visual/gameplay behavior.

## Current app shape

- `public/index.html`, `public/style.css`, and `public/client.js` are the browser client; `public/assets/` contains the 3D model and attribution/license files.
- `server.js` serves the static client and runs the WebSocket multiplayer service on the same HTTP origin.
- `package.json` declares the Node entrypoint and the `ws` WebSocket dependency.
- Room state is in memory for the lifetime of the server process. It is deliberately transient; there is no persistent player account or match-history database.
- The browser derives `ws:`/`wss:` from the current page origin, so a same-origin hosted WebSocket endpoint is expected.

## Sites compatibility request

Please inspect this existing project and confirm the supported Sites runtime can build and host its Node HTTP server, `ws` WebSocket upgrade handling, long-lived in-memory room state, and periodic game simulation. WebSockets must remain same-origin and work for visitors on separate devices. Preserve `/` static asset paths and serve the `.glb` model with the correct content type.

If the Sites runtime requires a small hosting adapter, make only deployment-boundary changes and preserve the complete game protocol and behavior. If Sites cannot keep the WebSocket session service and in-memory game loop running with shared room state across visitors, stop and report the exact incompatibility. Do not silently convert the app to a single-player or non-real-time version.

Save a reviewable version without deploying first. Report the files changed and verify: host creates a room, another browser/device joins the same code, map selection stays fixed for that room, role assignment/start still work, and both clients observe synchronized movement and match events.
