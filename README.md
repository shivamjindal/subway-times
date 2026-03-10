# NYC Subway Times

Minimal Next.js app for real-time NYC subway arrivals, service alerts, and a weather snapshot.

## What it does

- Search and pin multiple stations
- Fetch live arrivals from MTA GTFS-Realtime feeds
- Show active service alerts relevant to each station
- Filter arrivals by direction and route
- Reorder station chips/cards with drag-and-drop
- Show NYC weather (toggleable in settings)
- Persist selected stations and weather-card visibility in `localStorage`

## Stack

- Next.js 16 (App Router)
- React 19 + TypeScript
- Tailwind CSS 4
- dnd-kit
- gtfs-realtime-bindings
- next-themes

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

## Useful scripts

- `npm run dev` – start dev server
- `npm run lint` – run ESLint
- `npm run build` – production build
- `npm start` – run production build

## Data sources

- MTA GTFS-Realtime feeds (arrivals + subway alerts)
- National Weather Service API (`api.weather.gov`)

## Notes

- Station metadata comes from files in `gtfs_subway/` and generated mappings in `lib/`.
- To regenerate mappings from GTFS files:

```bash
npx tsx lib/gtfs-mappings.ts
```
