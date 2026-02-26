# AGENTS.md

## Cursor Cloud specific instructions

### Overview
This is a Next.js 16 single-page app (NYC Subway Times) that displays real-time subway arrivals and weather for NYC. There is one service: the Next.js dev server on port 3000, which serves both the frontend and two API routes (`/api/subway-times`, `/api/weather`).

### Running the app
- `npm run dev` starts the dev server (Turbopack) on port 3000.
- See `README.md` for full command reference (`dev`, `build`, `start`, `lint`).

### Network restrictions
- The app depends on external APIs (MTA GTFS-RT feeds, National Weather Service) that are **not reachable** from the cloud VM due to egress restrictions. The UI will show "Failed to fetch subway times" and "Failed to fetch weather" errors — this is expected.
- Google Fonts (`fonts.gstatic.com`) is also blocked. The layout uses `next/font/local` with the `geist` npm package to provide Geist/Geist Mono fonts locally. If someone reverts to `next/font/google`, both `npm run build` and `npm run dev` will fail in this environment.
- `npm run build` will fail due to font resolution issues even with local fonts (Turbopack production build still tries to resolve internal font loader modules). The dev server (`npm run dev`) works correctly.

### Lint
- `npm run lint` runs ESLint. There are pre-existing warnings and errors in the codebase (unused vars, `setState` in effects).

### Environment variables
- `MTA_API_KEY` — optional for dev, recommended for production. Not needed in cloud VM since MTA API is unreachable anyway.
