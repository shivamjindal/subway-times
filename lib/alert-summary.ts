import type { ServiceAlert } from './subway-parser';

const SUMMARY_MAX_CHARS = 80;

/** Alerts that would take more than a line on a phone start collapsed and expand on tap. */
export function isLongAlert(alert: Pick<ServiceAlert, 'headerText' | 'descriptionText'>): boolean {
  return Boolean(alert.descriptionText?.trim()) || alert.headerText.length > SUMMARY_MAX_CHARS;
}
