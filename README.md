# NYC Subway Times

Minimal Next.js app for real-time NYC subway arrivals, service alerts, and a weather snapshot.

## What it does

- Search and pin multiple stations
- Fetch live arrivals from MTA GTFS-Realtime feeds
- Show active service alerts relevant to each station
- Filter arrivals by direction and route
- Reorder station chips/cards with drag-and-drop
- Show NYC weather (toggleable in settings)
- Space network: a live 3D view where every train is a rocket launching, flying, and landing between spaceports
- Persist selected stations and weather-card visibility in `localStorage`
- Send feedback through a custom form at `/feedback` (Apps Script → Google Sheet)

## Stack

- Next.js 16 (App Router)
- React 19 + TypeScript
- Tailwind CSS 4
- dnd-kit
- gtfs-realtime-bindings
- next-themes
- three.js via @react-three/fiber, drei, postprocessing (space network only, lazy-loaded)

## Local development

```bash
npm install
npm run dev
```

Open: http://localhost:3000

### Environment variables

`MTA_API_KEY` is optional:

```bash
MTA_API_KEY=your_key_here
```

When provided, the app sends it as `x-api-key` to MTA feeds. If omitted, requests are made without the header.

## Feedback

`/feedback` (linked from the header) shows a HUD-styled form. The browser posts to
`POST /api/feedback`, which forwards JSON to a Google Apps Script web app that appends a row to a
Sheet. Set the webhook URL as a **server** env var (not `NEXT_PUBLIC_`):

```bash
FEEDBACK_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

If `FEEDBACK_WEBHOOK_URL` is missing or invalid, `/feedback` shows "Feedback channel offline" and the
API returns `503`.

### Apps Script setup

1. Create a Google Sheet with a header row: `Timestamp`, `Context`, `Message`.
2. Extensions → Apps Script, paste:

```javascript
const SHEET_NAME = 'Sheet1'; // rename if needed

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  sheet.appendRow([
    data.submittedAt || new Date().toISOString(),
    data.context || '',
    data.message || '',
  ]);
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. Deploy → New deployment → Web app. Execute as **Me**, Who has access **Anyone**.
4. Copy the `/exec` URL into `FEEDBACK_WEBHOOK_URL` (`.env.local` locally, or your host's env settings).

The form fields are: context (optional) and message (required). A honeypot field drops most bot
submissions. Redeploy the script after editing it; the deployment URL can stay the same if you
update that deployment.

## API routes

### `POST /api/feedback`

Body (JSON):
- `context` (string, optional)
- `message` (string, required)
- `website` (honeypot; non-empty values are dropped as success)

Returns `{ ok: true }` on success. `400` on validation errors, `503` when the webhook is not
configured, `502` when the Apps Script call fails.

### `GET /api/subway-times`

Query params:
- `stations` (optional): comma-separated station IDs, e.g. `F24,L08,N12`

Behavior:
- Defaults to `F24` when `stations` is missing/empty
- Validates IDs (`1-5` alphanumeric chars)
- Limits requests to max 10 stations
- Returns:
  - `arrivals`
  - `alerts`
  - `lastUpdated`

### `GET /api/weather`

Query params:
- `lat` (optional, default `40.7128`)
- `lon` (optional, default `-74.0060`)

Returns:
- `current`
- `today`
- `hourly`
- `location`
- `lastUpdated`

### `GET /api/train-positions`

Fetches every MTA trip-update feed and returns an estimated position for each active train:
- `trains`: `{ id, routeId, direction, from, to, departedAt, arrivesAt, departsAt, next?, nextArrivesAt?, basis }`
- `failedFeeds`: number of feeds that failed (the rest are still returned)
- `lastUpdated`

GTFS-Realtime has no train coordinates, so each train is placed on the segment between the station it
last left (`from`) and its next predicted stop (`to`). `basis` says how the segment start was found:
`feed` (the feed still lists the departed stop), `schedule` (backed out of scheduled run time), or
`stopped` (the feed reports the train stopped at a station, or it is waiting at its origin terminal).
`departsAt` is when the train leaves `to` again (at least a 20 s dwell, since feeds usually report
departure equal to arrival), and `next`/`nextArrivesAt` describe the following stop when the feed lists one.

## Space network

The top of the page is a live 3D view of the whole subway, re-skinned as a network of spaceports.
Each train is a rocket: it sits on the pad while dwelling, launches at its departure time, flies a
ballistic arc to the next station, and lands at its predicted arrival. Nothing 3D is downloaded until
the panel renders; collapsing it is remembered in `localStorage`.

- Every rocket's state is pure time math on its trip estimate (`components/orbital-map/rocket-timeline.ts`),
  so nothing is simulated per frame and a rocket entering view is already in the right place.
- Each 30 s poll is reconciled into the existing fleet rather than replanning it. A rocket keeps a stable identity
  (reacquired by route, direction, and station if its trip ID changes) and the visit it landed at, a landing or launch
  about to happen is pinned, new predictions retime only the rest, and a rocket whose train leaves the feed finishes
  its current plan. Berths and tracks are remembered across polls, and map poses ease over 2 s when a leg is retimed.
  `npm test` checks that rockets play as unbroken sequences across polls with drifting predictions, dropped stops
  and vehicles, trip ID changes, and track churn.
- In the full view, every rocket is one instanced draw (body, short trail); launches and landings fire a
  brief flare and ring from the event times. A ticker shows rockets in flight, landing, on pad, and the next
  launch (at a tracked spaceport when there is one).
- When zoomed, rockets, trails, and flares are culled against the camera frustum with a padded margin,
  recomputed on camera move (throttled to 150 ms, otherwise once a second). The nearest few rockets get a
  procedural booster model with grid fins, legs, and a landing/ascent plume.
- Clicking a spaceport or a rocket opens a close-up (lazy-loaded separately) re-creating the landing and launch:
  descent with grid fins, landing burn, legs, touchdown dust, venting on the pad, ignition, liftoff, and climb-out
  toward the next stop. Live mode follows the next real landing and launch with T−minus readouts; Replay plays the
  sequence on demand, optionally on a loop. The map pauses rendering while the close-up is open.
- Spaceports have pads. A spaceport is a station or a transfer complex (Times Sq groups the 1/2/3, 7, A/C/E, N/Q/R/W
  and S stops); each pad is one platform, a GTFS stop ID plus direction, labelled by line and direction
  (`L · Manhattan-bound`). Both come from `lib/spaceports.json`, generated by `scripts/build-subway-map.mjs`.
  When every train at a platform carries a NYCT track (the feed's `actual_track`, else `scheduled_track`), the pad is
  split further into one berth per track.
- Every arrival and departure is assigned to a berth, and each berth holds one rocket at a time. A train that arrives
  while its berth is occupied (or within 8 s of a launch) holds in a hover and lands once the berth clears; the delay
  carries into its later stops. This is display-only — the arrivals list still shows MTA predictions.
- On the map, each station gets a ring of pad markers (one instanced draw, shown when zoomed in) and rockets land on
  their own pad. The close-up lays out all of a spaceport's pads, animates every concurrent landing, hold, and launch,
  frames the camera to fit them, and lists the manifest by pad.
- `prefers-reduced-motion` disables camera flights and flares, steps rockets every 5 s, and shows the close-up as a
  still hero frame next to the live text manifest.
- No WebGL, a lost graphics context, or a render error shows a fallback; the ticker, manifests, and arrivals keep
  working. Low-power devices (≤4 cores, ≤4 GB memory, or Save-Data) skip bloom and trails, render at 1x DPR,
  and use fewer detail boosters and particles.
- Append `?perf=1` to show a frame-rate overlay with draw calls, CPU per frame, and visible/total rocket counts.
- `GET /api/train-positions` reports `trackCoverage` (stop updates, how many carry a scheduled or actual track, and
  how many were rerouted) so track reliability can be checked against the live feed.

## Useful scripts

- `npm run dev` – start dev server
- `npm run lint` – run ESLint
- `npm test` – run the Vitest suite
- `npm run build` – production build
- `npm start` – run production build
- `npm run map-data` – regenerate orbital map geometry/topology from `gtfs_subway/`

## Data sources

- MTA GTFS-Realtime feeds (arrivals + subway alerts)
- National Weather Service API (`api.weather.gov`)

## Notes

- Station metadata comes from files in `gtfs_subway/` and generated mappings in `lib/`.
- To regenerate mappings from GTFS files:

```bash
npx tsx lib/gtfs-mappings.ts
npm run map-data
```

`npm run map-data` writes `lib/subway-map-geometry.json` (station-to-station line polylines, ~40 KB,
loaded only by the map) and `lib/subway-map-topology.json` (previous-station lookup and scheduled
segment run times, used by `/api/train-positions`).
