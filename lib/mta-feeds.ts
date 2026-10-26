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

export const FEED_URLS: Record<string, string> = {
  'ace': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
  'bdfm': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
  'g': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
  'jz': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
  'nqrw': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
  'l': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
  '1234567': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
  'si': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si',
};

export function getMtaHeaders(): HeadersInit {
  const headers: HeadersInit = {};
  if (process.env.MTA_API_KEY) {
    headers['x-api-key'] = process.env.MTA_API_KEY;
  }
  return headers;
}
