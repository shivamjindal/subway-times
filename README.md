# F Train Times - 7th Ave Brooklyn

A Next.js web application that displays real-time F train arrival times at the 7th Ave station in Brooklyn (Manhattan-bound only).

## Features

- Real-time train arrival times
- Auto-refresh every 30 seconds
- Service alerts and delays
- Modern UI with shadcn/ui components
- Responsive design
- F train branding (orange #FF6319)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Get an MTA API key from [https://api.mta.info/](https://api.mta.info/)

3. Create a `.env.local` file in the root directory:
```bash
MTA_API_KEY=your_api_key_here
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- gtfs-realtime-bindings (for parsing MTA GTFS-RT feed)

## API Endpoint

The app uses the MTA GTFS-RT feed for B, D, F, M trains:
- Endpoint: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm`
- Stop ID: `F24N` (7th Ave Brooklyn, Manhattan-bound platform)

## Project Structure

```
subway-times/
├── app/
│   ├── api/
│   │   └── subway-times/
│   │       └── route.ts          # API endpoint
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Main page
│   └── globals.css               # Global styles
├── components/
│   ├── ui/                       # shadcn components
│   └── subway-times-display.tsx  # Main display component
└── lib/
    ├── subway-parser.ts          # GTFS parsing logic
    └── utils.ts                  # shadcn utils
```
