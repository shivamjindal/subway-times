const ROUTE_NAMES: Record<string, string> = {
  FX: 'F Express',
  '6X': '6 Express',
  '7X': '7 Express',
  GS: '42 St Shuttle',
  FS: 'Franklin Av Shuttle',
  H: 'Rockaway Park Shuttle',
  SI: 'Staten Island Railway',
};

/** Spells out route bullets riders can't decode on sight, e.g. "6X" → "6 Express". */
export function getRouteName(routeId: string): string {
  return ROUTE_NAMES[routeId] ?? `${routeId} train`;
}

/** MTA "N"/"S" means Uptown/Downtown on Manhattan lines; on crosstown lines pair it with the terminal name. */
export function getDirectionName(direction: 'N' | 'S'): 'Uptown' | 'Downtown' {
  return direction === 'N' ? 'Uptown' : 'Downtown';
}

export function formatMinutesAway(secondsUntilArrival: number): string {
  if (secondsUntilArrival < 60) return 'Now';
  return `${Math.floor(secondsUntilArrival / 60)} min`;
}

const ALERT_SUMMARY_MAX = 120;

/** Short alert line shown collapsed; the full text sits behind "Show details". */
export function summarizeAlert(headerText: string): { summary: string; truncated: boolean } {
  const text = headerText.replace(/\s+/g, ' ').trim();
  if (text.length <= ALERT_SUMMARY_MAX) return { summary: text, truncated: false };
  const cut = text.slice(0, ALERT_SUMMARY_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return { summary: `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`, truncated: true };
}
