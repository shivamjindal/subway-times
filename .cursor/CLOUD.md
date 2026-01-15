# NYC Subway Times - Cloud Development Guide

## Overview
A Next.js 16 web application displaying real-time NYC subway arrival times with weather integration.

## Quick Commands

| Task | Command |
|------|---------|
| Development server | `npm run dev` (port 3000) |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Production server | `npm start` |

## Key Architecture

- **Framework**: Next.js 16 with App Router and Turbopack
- **API Routes**: 
  - `/api/subway-times` - MTA GTFS-RT real-time feed parsing
  - `/api/weather` - National Weather Service integration
- **Static Data**: GTFS station/route mappings in `lib/*.json` (pre-processed)

## External Dependencies

- **MTA GTFS-RT API**: Real-time subway data (public, optional `MTA_API_KEY` env var for higher rate limits)
- **National Weather Service API**: Weather data (public, no auth required)

## Notes

- Pre-existing lint errors in `settings-button.tsx` and `split-flap-time.tsx` (React hooks set-state-in-effect pattern for hydration safety)
- No automated tests in this project
- GTFS static data files in `gtfs_subway/` directory are for reference; the app uses pre-processed JSON mappings in `lib/`
