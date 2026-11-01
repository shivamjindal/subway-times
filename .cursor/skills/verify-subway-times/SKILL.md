---
name: verify-subway-times
description: Launch the real subway-times app (Next.js 16, space-themed Three.js subway map where trains are rockets), drive it in headless Chrome over CDP like a user, and capture proof. Covers the web UI (live network map, spaceport close-up, station search, /feedback) and the API routes /api/train-positions, /api/subway-times, /api/feedback, /api/weather. Use before claiming any UI or API change in this repo works, when reproducing a reported bug, or when a PR needs screenshots or evidence.
---

# Verify subway-times

Real app, real browser, real user path. All helpers are in `.cursor/skills/verify-subway-times/scripts/` and run from the repo root.
Per-feature journeys and their traps are in `features/` next to this file. Read the one you're verifying before you start.

| Thing | Value |
|---|---|
| App port | `3100` (default `--port`; avoids a developer's own `npm run dev` on 3000) |
| Mock MTA feed | port + 801 (`3901`), only with `--mock` / `--rush` |
| Mock Apps Script webhook | port + 802 (`3902`) |
| State (pids, logs) | `/tmp/verify-subway-times/<port>/` (`VERIFY_STATE_ROOT` overrides) |
| Evidence | `/opt/cursor/artifacts/verify-subway-times/<journey>-<UTC stamp>/` (`EVIDENCE_ROOT` overrides) |
| Env the app reads | `MTA_API_KEY` (optional, sent as `x-api-key`), `MTA_FEED_BASE_URL` (mock only), `FEEDBACK_WEBHOOK_URL` |
| Needs | Node ≥ 22.18 (global `WebSocket`, TS type stripping for the mock), `google-chrome` (or `CHROME_BIN`), `curl` |

## Launch

The live MTA feed is the default. Check it first:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace'   # 200 = live is usable
```

```bash
.cursor/skills/verify-subway-times/scripts/launch.sh --prod          # next build + next start, live feed (use for the close-up)
.cursor/skills/verify-subway-times/scripts/launch.sh                 # next dev, live feed (fast; map, search, feedback)
.cursor/skills/verify-subway-times/scripts/launch.sh --mock          # fallback: offline machine, mock MTA feed
.cursor/skills/verify-subway-times/scripts/launch.sh --rush --prod   # repeatable rush hour (120 s headways on every line)
```

- **`--prod` is required for the spaceport close-up.** Under `next dev`, React StrictMode closes the dialog the moment it opens (see `features/spaceport-closeup.md`). `--prod` was ready in about 20 s here (build included). Dev is ready in about 15 s.
- The live preflight fails fast with `live MTA feed unreachable … rerun with --mock`. It never falls back to the mock silently.
- **Ready signal.** `launch.sh` only returns 0 after `drive.mjs ready` passes. That check loads `/?perf=1` in headless Chrome and waits for three things: the map's `role="img"` element (`aria-label` starting `3D network of NYC subway spaceports with N rockets`, N > 0) containing a `<canvas>`; `[data-testid=network-ticker]` reading `… in flight …`; and the renderer's own frame stats (`window.__spaceNetworkPerf`) showing `fps > 0` and `visible > 0` rockets. A port that answers is not ready, and neither is a page that loads.
- Live output looks like `PASS renderer drawing rockets · 7 FPS · 396/583 rockets visible` (SwiftShader software GL, so FPS is low and that's fine).
- **Teardown** is `scripts/cleanup.sh --port <port>` (see Cleanup).
- **Two at once.** `next dev` takes `.next/dev/lock`, so a second `next dev` in the same checkout dies with `Unable to acquire lock`. You can run one dev and one `--prod` instance side by side on different ports (`.next/dev` vs `.next`). For two dev servers, use `git worktree add` and run `npm ci` in the worktree. Don't run two `--prod` launches in one checkout, because the second `next build` rewrites `.next` under the first (doctor flags this as a `BUILD_ID` mismatch).

### Mock MTA feed (fallback only)

Use it when the live feed is unreachable (offline or sandboxed machines), or when you need a repeatable case such as rush hour.
`scripts/mock-mta.mjs` serves GTFS-Realtime protobuf at the real feed's paths (`/nyct%2Fgtfs-ace`, …, `/camsys%2Fsubway-alerts` empty). The app reaches it through `MTA_FEED_BASE_URL` in `lib/mta-feeds.ts`. **That variable is the only seam:** the mock replaces the MTA fetch boundary and nothing else. Parsing, `estimateTrainPositions`, fleet reconciliation, and rendering all run for real.
It builds the longest weekday pattern per route and direction from `gtfs_subway/` (58 patterns) and runs one train per headway, anchored to the epoch, so consecutive polls describe the same trains. Every trip ID starts with `MOCK_`. It doesn't simulate churn (drift, dropped stops, trip ID changes). The vitest suites `components/orbital-map/rocket-continuity.test.ts` and `busy-spaceport.test.ts` own that, along with the rush-hour Times Sq feed from PRs #24/#27. Those PRs' browser mocks were never committed. This script replaces them.
Standalone: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON .cursor/skills/verify-subway-times/scripts/mock-mta.mjs --port 3901 --rush`, then `curl -s localhost:3901/__health`.

## Doctor

```bash
node .cursor/skills/verify-subway-times/scripts/doctor.mjs --port 3100          # human-readable; add --json for machines
```

It's read-only: it reads `/proc`, `state.json`, `.next/BUILD_ID`, and two GETs. It exits 0 only when everything is `ok`:

- **process up**: the recorded `next`, mock, and webhook PIDs are alive.
- **port is ours**: the socket listening on the port belongs to a process in the process group `launch.sh` started. It's resolved through `/proc/net/tcp` because there's no `ss` here.
- **right build**: the server's cwd is this checkout and HEAD equals the commit it was launched at. For `--prod`, `.next/BUILD_ID` must also equal the one built at launch.
- **feed: LIVE or MOCK**: it looks at both the server's env (`MTA_FEED_BASE_URL` set or not) and the data itself (`MOCK_` trip IDs in `/api/train-positions`). It also reports train count and `failedFeeds`, and checks the feed matches what was launched.
- **feedback webhook**: local mock, a real Apps Script URL (which writes to the Sheet), or unset (`/feedback` shows "Feedback channel offline").

Healthy live output ends with `HEALTHY · live feed · http://localhost:3100`.

## Drive

```bash
node .cursor/skills/verify-subway-times/scripts/drive.mjs <ready|map|search|closeup|card-closeup|home|feedback> --port 3100
```

`drive.mjs` starts its own headless Chrome (`--use-angle=swiftshader --enable-unsafe-swiftshader`, 1440×1000) with a throwaway profile, talks CDP over Node's `WebSocket`, and kills Chrome on exit.
Input is real: `Input.dispatchMouseEvent` at the element's centre, `Input.insertText`, and real `Enter`/`Escape` key events. It records `/api/*` traffic, including POST bodies, plus console errors.
Each journey's steps and assertions are in `features/<feature>.md`. Stable handles, all existing, with no test IDs added:

| Handle | What |
|---|---|
| `[role=img][aria-label^="3D network of NYC subway spaceports with"]` | map; the label carries the rocket count |
| `[data-testid=network-ticker]` | in flight / landing / holding / on pad / next launch |
| `button[aria-controls=orbital-map-body]` | Collapse / Open network (`localStorage.orbitalMapOpen`) |
| `#station-search` | search input; Enter locks the first untracked result |
| `[aria-label="Remove <station>"]` | tracked-station chip (`localStorage.selectedStations`) |
| `button[aria-pressed]` with station name | "Tracked spaceports" list in the map sidebar |
| button text `Enter spaceport` | opens the close-up `<dialog>` from the map sidebar |
| `[aria-label="View platforms: <station>"]` | same close-up, from a station card |
| `dialog[open] #spaceport-title`, `[data-testid=pad-count]`, `[data-testid=pad-phase]`, `[data-testid=pad-manifest] [data-pad]` | close-up |
| `[aria-label="Close spaceport"]` | closes the close-up |
| `[aria-label="Send feedback"]` → `/feedback`; `#feedback-context`, `#feedback-message`, `button[type=submit]`, `#feedback-sent-title` | feedback |
| `/?perf=1`, `window.__spaceNetworkPerf` | renderer frame stats (FPS, draws, visible/total rockets) |

Don't click the WebGL canvas to pick a spaceport. Pixel targets move with the camera and the data. Go through search, then "Tracked spaceports", then "Enter spaceport", which is a real user path with stable handles.
For APIs, hit them directly against the running app: `curl -s localhost:3100/api/train-positions | head -c 300`, `curl -s 'localhost:3100/api/subway-times?stations=127'`, `curl -s localhost:3100/api/weather`. `/api/weather` calls `api.weather.gov` live; there's no mock.

## Evidence

- Every run writes `/opt/cursor/artifacts/verify-subway-times/<journey>-<stamp>/` containing `*.png`, `report.json` (every check with pass/fail and detail, plus feed, URL, and git SHA), `network.json` (`/api/*` requests and statuses, with POST bodies), `console.json` (errors and warnings), and `webhook.jsonl` for feedback. A failure adds `failure.png`.
- Proof standards:
  - Drive the real user path (search, click, type). Don't jump straight to a deep state with `localStorage` or URL hacks. Clearing state before a journey is fine.
  - Capture the action and the resulting state: a screenshot before and after, plus a DOM assertion on the result, not only a picture.
  - Verify side effects at the boundary. Feedback isn't done when the page says "Transmission received". The run must also show the browser's POST body and the exact `{context, message, submittedAt}` the mock Apps Script received.
  - Mocks are allowed only at two boundaries: the MTA feed (`MTA_FEED_BASE_URL`) and the Apps Script webhook (`FEEDBACK_WEBHOOK_URL`). Don't stub `fetch` in the page, the API routes, or the fleet.
  - Say which feed the evidence came from (LIVE or MOCK; it's in `report.json`). Live data changes every 30 s, so assert invariants (counts > 0, pads ≥ platforms, labels), not exact trains.
  - Don't weaken a journey to make it pass. If it fails, the failure is the finding.

## Cleanup

```bash
.cursor/skills/verify-subway-times/scripts/cleanup.sh --port 3100
```

Cleanup kills only the process groups recorded in `state.json` (next, mock MTA, webhook, and any Chrome a crashed drive left behind). Before killing, it checks each PID still runs the command we started. It never runs `pkill next`.
It archives `state.json`, the logs, and `webhook.jsonl` to `/opt/cursor/artifacts/verify-subway-times/server-logs-<port>-<stamp>/`, then deletes the state dir. Evidence directories are never touched. Run it after every failed attempt too, then confirm with `ls /opt/cursor/artifacts/verify-subway-times/`.

## Helpers

| Script | Invocation |
|---|---|
| `scripts/launch.sh` | `.cursor/skills/verify-subway-times/scripts/launch.sh [--port 3100] [--prod] [--mock \| --rush] [--real-webhook]` |
| `scripts/doctor.mjs` | `node .cursor/skills/verify-subway-times/scripts/doctor.mjs [--port 3100] [--json]` |
| `scripts/drive.mjs` | `node .cursor/skills/verify-subway-times/scripts/drive.mjs <ready\|map\|search\|closeup\|card-closeup\|home\|feedback> [--port 3100] [--out DIR]` |
| `scripts/cleanup.sh` | `.cursor/skills/verify-subway-times/scripts/cleanup.sh [--port 3100]` |
| `scripts/mock-mta.mjs` | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON .cursor/skills/verify-subway-times/scripts/mock-mta.mjs --port 3901 [--rush \| --headway 360]` |
| `scripts/mock-webhook.mjs` | `node .cursor/skills/verify-subway-times/scripts/mock-webhook.mjs --port 3902 --log webhook.jsonl [--fail]` |

A full close-up proof run, end to end:

```bash
.cursor/skills/verify-subway-times/scripts/launch.sh --prod \
  && node .cursor/skills/verify-subway-times/scripts/doctor.mjs \
  && node .cursor/skills/verify-subway-times/scripts/drive.mjs closeup; \
  .cursor/skills/verify-subway-times/scripts/cleanup.sh; ls /opt/cursor/artifacts/verify-subway-times/
```
