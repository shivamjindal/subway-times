import type { ServiceAlert } from './subway-parser';

const MAX_SUMMARY_LENGTH = 90;

/** One-line headline for a stack of alerts: the first header, trimmed, plus how many more are queued. */
export function summarizeAlerts(alerts: Pick<ServiceAlert, 'headerText'>[]): string {
  if (alerts.length === 0) return '';
  const first = alerts[0].headerText.replace(/\s+/g, ' ').trim();
  const headline = first.length > MAX_SUMMARY_LENGTH ? `${first.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…` : first;
  return alerts.length > 1 ? `${headline} (+${alerts.length - 1} more)` : headline;
}
