# Live network map

## Sub-features

- A 3D "Space network · Live" panel at the top of `/`. Every train from `/api/train-positions` is a rocket that dwells on its pad, launches, flies an arc, and lands. It polls every 30 s.
- A ticker (`[data-testid=network-ticker]`) showing counts in flight, landing, holding, and on pad, plus the next launch (at a tracked spaceport if there is one).
- A sidebar with "No target selected" or "Target locked", "Tracked spaceports", the trajectory legend, and the status line `N rockets tracked (estimated)` (plus `· K feeds offline` when feeds fail).
- Collapse / Open network, remembered in `localStorage.orbitalMapOpen`.
- `button[aria-label="3D map"]` (`aria-pressed`) turns only the WebGL scene off, keeping ticker and sidebar; remembered in `localStorage.orbitalMap3d` (`off` / `on`).
- The scene mounts lazily: after arrivals load, once the map is in view, on an idle callback. Its frame loop stops while the map is offscreen or the tab is hidden.
- A plain wheel over the map scrolls the page. Ctrl+wheel or pinch zooms; clicking the map engages it (`[data-map-engaged=true]`) so wheel and one-finger drags drive the camera. Leaving the map, clicking outside, or Esc releases it. Hovering shows "Click to interact".
- "Overview" resets the camera.
- `?perf=1` adds a frame-stats overlay and `window.__spaceNetworkPerf`.
- Fallbacks: no WebGL or a lost context shows "3D network unavailable" with "Retry renderer"; the ticker, manifests, and arrivals keep working.

## How to get to it (user POV)

Open `http://localhost:3100/`. The map is open by default. Wait for "Plotting trajectories…" to give way to rockets. Use the "Collapse" button in the panel header to hide it, and "Open network" to bring it back.

## Driving it with drive.mjs

```bash
.cursor/skills/verify-subway-times/scripts/launch.sh
node .cursor/skills/verify-subway-times/scripts/drive.mjs map
```

The journey runs these steps:

1. It loads `/` and waits for the map `role=img` (whose label carries the rocket count) to contain a `<canvas>` and for the ticker to show `in flight`.
2. It asserts the page polled `/api/train-positions` and got 200, then re-fetches it to compare the rocket count with the train count. They must be within 20% or 25, because the fleet keeps rockets finishing their plan after their train leaves the feed. The same step records LIVE or MOCK.
3. It takes `map-overview.png`.
4. It clicks Collapse and asserts `#orbital-map-body` is gone and `orbitalMapOpen === 'false'`, taking `map-collapsed.png`.
5. It clicks "Open network" and asserts rockets are back.

"Rockets rendered" proof comes from `drive.mjs ready` (run by launch), which reads `window.__spaceNetworkPerf.visible > 0` and `fps > 0` on `/?perf=1`.

## Gotchas

- **Collapse (or 3D off) then reopen must show rockets, not "The graphics context was lost."** R3F force-loses the old context after unmounting the canvas; `ContextLossListener` in `orbital-map-scene.tsx` removes its `webglcontextlost` listener on unmount so that isn't mistaken for a real loss. `drive.mjs map` guards this at "map reopens with rockets". Don't drop that step.
- When clicking the canvas to engage the map, avoid stations: a station click opens the close-up modal, the pointer leaves the map, and engagement is released (correctly).
- The collapse state persists in `localStorage`. The journey reopens the map, but a crashed run may leave it collapsed in that profile. `drive.mjs` uses a fresh profile per run, so this only bites manual sessions.
- SwiftShader renders at about 5–10 FPS. Don't assert frame rate beyond `> 0`. Real-GPU performance isn't measurable on a cloud VM.
- Live counts move every poll. A rocket count of about 590 against about 590 trains is typical at 4 pm ET, but assert relationships, never exact numbers.
- With `--mock`, all rockets follow fixed headways (360 s, or 120 s with `--rush`), so the map looks more regular than live. It doesn't exercise prediction churn.
- Don't pick spaceports by clicking canvas pixels. Use the "Tracked spaceports" buttons, which call the same `selectStation` / `enterSpaceport` handlers as a canvas click.
