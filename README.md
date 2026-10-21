# NYC Subway Times

Minimal Next.js app for real-time NYC subway arrivals, service alerts, and a weather snapshot.

## What it does

- Search and pin multiple stations
- Fetch live arrivals from MTA GTFS-Realtime feeds
- Show active service alerts relevant to each station
- Filter arrivals by direction and route
- Reorder station chips/cards with drag-and-drop
- Show NYC weather (toggleable in settings)
- Orbital map: optional 3D view of every line, station, and estimated train positions
- Persist selected stations and weather-card visibility in `localStorage`

## Stack

- Next.js 16 (App Router)
- React 19 + TypeScript
- Tailwind CSS 4
- dnd-kit
- gtfs-realtime-bindings
- next-themes
- three.js via @react-three/fiber, drei, postprocessing (orbital map only, lazy-loaded)

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

## API routes

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
- `trains`: `{ id, routeId, direction, from, to, departedAt, arrivesAt, basis }`
- `failedFeeds`: number of feeds that failed (the rest are still returned)
- `lastUpdated`

GTFS-Realtime has no train coordinates, so each train is placed on the segment between the station it
last left (`from`) and its next predicted stop (`to`). `basis` says how the segment start was found:
`feed` (the feed still lists the departed stop), `schedule` (backed out of scheduled run time), or
`stopped` (the feed reports the train stopped at a station, or it is waiting at its origin terminal).

## Orbital map

A collapsible panel below the station search. Nothing 3D is downloaded until it is opened; the
open/closed state is remembered in `localStorage`.

- Clicking a station node flies the camera to it; untracked stations can be added with **Track station**.
- Tracked stations get beacons and labels; the sidebar lists them as keyboard-accessible buttons.
- `prefers-reduced-motion` disables camera flights and pulsing and steps train positions every 5s.
- No WebGL, a lost graphics context, or a render error shows a fallback; arrivals never depend on the map.
  Low-power devices (≤4 cores, ≤4 GB memory, or Save-Data) skip bloom and render at 1x DPR.

## Useful scripts

- `npm run dev` – start dev server
- `npm run lint` – run ESLint
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
