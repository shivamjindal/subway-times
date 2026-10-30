// Map routes to MTA feed groups
export const ROUTE_TO_FEED: Record<string, string> = {
  'A': 'ace',
  'C': 'ace',
  'E': 'ace',
  'H': 'ace', // Rockaway Park Shuttle (connects with A line)
  'B': 'bdfm',
  'D': 'bdfm',
  'F': 'bdfm',
  'FX': 'bdfm', // F Express
  'FS': 'bdfm', // Franklin Avenue Shuttle (connects with F line)
  'M': 'bdfm',
  'G': 'g',
  'GS': '1234567', // 42 St Shuttle (connects Grand Central and Times Square)
  'J': 'jz',
  'Z': 'jz',
  'N': 'nqrw',
  'Q': 'nqrw',
  'R': 'nqrw',
  'W': 'nqrw',
  'L': 'l',
  '1': '1234567',
  '2': '1234567',
  '3': '1234567',
  '4': '1234567',
  '5': '1234567',
  '6': '1234567',
  '6X': '1234567', // 6 Express
  '7': '1234567',
  '7X': '1234567', // 7 Express
  'SI': 'si',
};

const MTA_FEED_BASE_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds';

// Server-only override (e.g. a local mock feed for offline or repeatable verification); paths stay the same.
const feedBase = (process.env.MTA_FEED_BASE_URL?.trim() || MTA_FEED_BASE_URL).replace(/\/+$/, '');

export const FEED_URLS: Record<string, string> = {
  'ace': `${feedBase}/nyct%2Fgtfs-ace`,
  'bdfm': `${feedBase}/nyct%2Fgtfs-bdfm`,
  'g': `${feedBase}/nyct%2Fgtfs-g`,
  'jz': `${feedBase}/nyct%2Fgtfs-jz`,
  'nqrw': `${feedBase}/nyct%2Fgtfs-nqrw`,
  'l': `${feedBase}/nyct%2Fgtfs-l`,
  '1234567': `${feedBase}/nyct%2Fgtfs`,
  'si': `${feedBase}/nyct%2Fgtfs-si`,
};

export const ALERTS_FEED_URL = `${feedBase}/camsys%2Fsubway-alerts`;

export function getMtaHeaders(): HeadersInit {
  const headers: HeadersInit = {};
  if (process.env.MTA_API_KEY) {
    headers['x-api-key'] = process.env.MTA_API_KEY;
  }
  return headers;
}
