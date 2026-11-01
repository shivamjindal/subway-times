# Station search, tracking, and station cards

## Sub-features

- Search box `#station-search` (placeholder "Search for a station (e.g. Times Sq, 7 Av)"). Suggestions show route bullets and "Add ↵". Enter locks the first result that isn't already tracked, and IME composition Enter is ignored.
- Tracked chips (`[aria-label="Remove <name>"]`), drag to reorder and tap to filter when there are 2 or more. They persist in `localStorage.selectedStations` as `[{stationId, direction, selectedRoutes}]`.
- Station cards (`h2` = station name) list arrivals from `GET /api/subway-times?stations=<ids>` (max 10 IDs, each 1–5 alphanumerics). The cards also have route toggles (`aria-label="Select <route> route"` / `"Deselect …"`), collapse (`aria-label="Collapse station"`), service alerts (`role=alert`), and "Arrives in N minutes" labels.
- Tracking a station pins a beacon on the map and lists it under "Tracked stations".
- The header's refresh button (`aria-label="Refresh arrivals"`) refetches arrivals. The weather card (`/api/weather`, NWS) can be toggled in Settings (`aria-label="Settings"`).

## How to get to it (user POV)

On `/`, scroll below the map to "Target acquisition · Add a station", type a name, then press Enter or click a result. The chip and card appear right away and arrivals load within a few seconds. Remove a station with the X on its chip.

## Driving it with drive.mjs

```bash
.cursor/skills/verify-subway-times/scripts/launch.sh
node .cursor/skills/verify-subway-times/scripts/drive.mjs search
```

The journey runs these steps:

1. It clears `selectedStations`, clicks `#station-search`, types "Times Sq", and waits for a "Times Sq-42 St" suggestion (`search-suggestions.png`).
2. It presses Enter and asserts the `Remove Times Sq-42 St` chip appears and `localStorage` holds station `127` (the first result).
3. It asserts the card `h2` "Times Sq-42 St" is shown and the browser's `/api/subway-times?stations=127` returned 200 (`search-tracked.png`).
4. It reloads and asserts the chip survived.
5. It clicks the chip's remove button and asserts `127` is gone from `localStorage`.

For the API alone: `curl -s 'localhost:3100/api/subway-times?stations=127,F24' | head -c 400` and `curl -s -o /dev/null -w '%{http_code}' 'localhost:3100/api/subway-times?stations=bad!'` (400).

## Gotchas

- "Times Sq" matches four station IDs with the same name (127, 725, 902, R16), all in one spaceport. Enter picks 127 (1/2/3). Assert on the ID, not only the name.
- Suggestions select on `mousedown` and the box hides suggestions 200 ms after blur. A synthetic `element.click()` won't select. Use real mouse events or Enter (as `drive.mjs` does).
- Arrivals come from the MTA feed for that station's routes. On `--mock`, arrivals exist only for stops on the mock's 58 patterns. That covers every route's main pattern, but not branch-only stops.
- The weather card needs `api.weather.gov`. It was reachable from this VM. If it isn't, the card shows an error and the rest of the page still works. There's no weather mock, so don't count a weather failure against search.
