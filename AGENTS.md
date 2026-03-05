# AGENTS.md

## Cursor Cloud specific instructions

### Overview
This is a Next.js 16 single-page app (NYC Subway Times) that displays real-time subway arrivals and weather for NYC. There is one service: the Next.js dev server on port 3000, which serves both the frontend and two API routes (`/api/subway-times`, `/api/weather`).

### Running the app
- `npm run dev` starts the dev server (Turbopack) on port 3000.
- See `README.md` for full command reference (`dev`, `build`, `start`, `lint`).

### Google Fonts workaround
- Google Fonts (`fonts.gstatic.com`) is blocked in the cloud VM. The layout uses `next/font/local` with the `geist` npm package to provide Geist/Geist Mono fonts locally. If someone reverts to `next/font/google`, both `npm run build` and `npm run dev` will fail in this environment.
- `npm run build` will fail due to font resolution issues even with local fonts (Turbopack production build still tries to resolve internal font loader modules). The dev server (`npm run dev`) works correctly.

### External APIs
- MTA GTFS-RT feeds and National Weather Service API are **reachable** from the cloud VM — live subway arrivals and weather data work.

### Lint
- `npm run lint` runs ESLint. There are pre-existing warnings and errors in the codebase (unused vars, `setState` in effects).

### Environment variables
- `MTA_API_KEY` — optional for dev (feeds work without it), recommended for production.
