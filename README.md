# NYC Subway Times

A modern Next.js web application that displays real-time NYC subway arrival times for multiple stations with weather insights.

## Features

### Subway Times
- **Multi-Station Support** - Search and select multiple NYC subway stations simultaneously
- **Real-Time Arrivals** - Live train arrival times from MTA GTFS-RT feeds
- **Auto-Refresh** - Updates every 30 seconds to keep arrival times current
- **Service Alerts** - Displays active MTA service alerts and delays
- **Direction Filtering** - Filter trains by northbound/southbound or view all
- **Route Filtering** - Click train line badges to filter by specific routes
- **Station Filtering** - Click station chips to focus on specific stations
- **Drag & Drop Reordering** - Reorder stations and station chips by dragging
- **Persistent Settings** - Saves selected stations and preferences to localStorage

### Weather
- **NYC Weather Integration** - Real-time weather from National Weather Service API
- **Hourly Forecast** - Next 12 hours with temperature, conditions, and precipitation probability
- **Auto-Refresh** - Updates every 15 minutes
- **Toggle Visibility** - Show/hide weather card via settings panel

### UI/UX
- **Dark/Light Theme** - Toggle with animated switch, respects system preferences
- **Responsive Design** - Works seamlessly on mobile and desktop
- **Modern UI** - Built with shadcn/ui components
- **Authentic Subway Branding** - Uses official MTA route colors and styling
- **Smooth Animations** - Polished transitions and interactions

## Tech Stack

- **Next.js 16** - React framework with App Router
- **React 19** - Latest React with concurrent features
- **TypeScript** - Type-safe development
- **Tailwind CSS 4** - Utility-first styling
- **shadcn/ui** - High-quality component library
- **next-themes** - Theme management with system preference support
- **dnd-kit** - Accessible drag and drop functionality
- **gtfs-realtime-bindings** - Parse MTA GTFS-RT protobuf feeds
- **Vercel Analytics** - Production analytics

## Getting Started

### Prerequisites

- Node.js 20+ and npm

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd subway-times
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file in the root directory:
```bash
MTA_API_KEY=your_api_key_here
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Usage

1. **Search for Stations** - Type in the search bar to find NYC subway stations
2. **Select Stations** - Click on a station from the dropdown to add it
3. **View Arrivals** - See real-time train arrivals grouped by station
4. **Filter Results** - 
   - Click direction buttons (All/Northbound/Southbound) to filter by direction
   - Click train line badges to filter by specific routes
   - Click station chips at the top to filter visible stations
5. **Reorder Stations** - Drag station cards or chips to reorder them
6. **Remove Stations** - Click the X button on station chips to remove them
7. **Toggle Theme** - Click the theme toggle switch in the top-right corner
8. **Settings** - Click the settings icon to show/hide the weather card

## API Endpoints

### Subway Times API
- **Endpoint**: `/api/subway-times`
- **Query Params**: `?stations=F24,L08,N12` (comma-separated station IDs)
- **Data Source**: MTA GTFS-RT feeds for all subway lines
- **Caching**: 30 second revalidation

### Weather API
- **Endpoint**: `/api/weather`
- **Query Params**: `?lat=40.7128&lon=-74.0060` (optional, defaults to NYC)
- **Data Source**: National Weather Service API
- **Caching**: 15 minute revalidation for forecasts

## Project Structure

```
subway-times/
├── app/
│   ├── api/
│   │   ├── subway-times/
│   │   │   └── route.ts          # Subway arrivals API endpoint
│   │   └── weather/
│   │       └── route.ts          # Weather API endpoint
│   ├── layout.tsx                # Root layout with theme provider
│   ├── page.tsx                  # Main page
│   └── globals.css               # Global styles
├── components/
│   ├── ui/                       # shadcn/ui components
│   ├── subway-times-display.tsx  # Main display component
│   ├── station-selector.tsx      # Station search and selection
│   ├── station-card.tsx          # Individual station card
│   ├── theme-toggle.tsx          # Dark/light theme toggle
│   ├── theme-provider.tsx        # Theme context provider
│   └── settings-button.tsx       # Settings dropdown
├── lib/
│   ├── subway-data.ts            # Station and route data utilities
│   ├── subway-parser.ts          # GTFS-RT parsing logic
│   ├── gtfs-mappings.ts          # Route/station mappings
│   ├── fetch-with-timeout.ts    # Timeout wrapper for fetch
│   └── utils.ts                  # General utilities
├── gtfs_subway/                  # GTFS static data files
└── public/                       # Static assets
```

## Data Sources

### MTA GTFS-RT Feeds
The app fetches from multiple MTA GTFS-RT feeds based on the selected stations:
- **ACE Lines**: `nyct%2Fgtfs-ace`
- **BDFM Lines**: `nyct%2Fgtfs-bdfm`
- **G Line**: `nyct%2Fgtfs-g`
- **JZ Lines**: `nyct%2Fgtfs-jz`
- **NQRW Lines**: `nyct%2Fgtfs-nqrw`
- **L Line**: `nyct%2Fgtfs-l`
- **1234567 Lines**: `nyct%2Fgtfs`
- **SI Line**: `nyct%2Fgtfs-si`

### GTFS Static Data
Station and route information is derived from official MTA GTFS static data files in the `gtfs_subway/` directory.

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

### Environment Variables

- `MTA_API_KEY` - Your MTA API key (required for production)

## Features in Detail

### Station Selection
The station selector uses a fuzzy search algorithm to find stations by name. Search results show all routes that stop at each station with authentic MTA colors.

### Direction Detection
The app intelligently determines northbound and southbound labels based on actual train destinations (e.g., "To Manhattan" vs "To Brooklyn" at 7th Ave station).

### Route Filtering
Click any train line badge to toggle filtering by that route. When routes are selected, unselected routes appear dimmed. Click again to deselect, or select all routes to reset.

### Drag and Drop
Uses `@dnd-kit` for accessible drag and drop. Both station cards and station chips can be reordered by dragging.

### Theme System
Uses `next-themes` with system preference detection. The theme toggle shows a smooth animated switch with sun/moon icons.

### Weather Integration
Fetches weather from the National Weather Service API, which provides free, reliable weather data for US locations. Shows current conditions, daily high/low, and a 12-hour forecast.

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## License

This project is for educational and personal use. MTA data is subject to [MTA's Terms of Use](https://api.mta.info/#/HelpDocument).

## Acknowledgments

- MTA for providing free real-time transit data
- National Weather Service for free weather data
- shadcn/ui for the beautiful component library
- Vercel for hosting and analytics
