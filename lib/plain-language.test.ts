import { describe, expect, it } from 'vitest';
import { formatMinutesAway, getDirectionName, getRouteName, summarizeAlert } from './plain-language';

describe('getRouteName', () => {
  it('spells out express and shuttle bullets', () => {
    expect(getRouteName('6X')).toBe('6 Express');
    expect(getRouteName('7X')).toBe('7 Express');
    expect(getRouteName('FX')).toBe('F Express');
    expect(getRouteName('GS')).toBe('42 St Shuttle');
    expect(getRouteName('SI')).toBe('Staten Island Railway');
  });

  it('labels plain bullets as trains', () => {
    expect(getRouteName('A')).toBe('A train');
    expect(getRouteName('6')).toBe('6 train');
  });
});

describe('getDirectionName', () => {
  it('maps MTA directions to Uptown/Downtown', () => {
    expect(getDirectionName('N')).toBe('Uptown');
    expect(getDirectionName('S')).toBe('Downtown');
  });
});

describe('formatMinutesAway', () => {
  it('shows whole minutes, rounding down', () => {
    expect(formatMinutesAway(60)).toBe('1 min');
    expect(formatMinutesAway(359)).toBe('5 min');
    expect(formatMinutesAway(1200)).toBe('20 min');
  });

  it('shows Now inside the last minute', () => {
    expect(formatMinutesAway(0)).toBe('Now');
    expect(formatMinutesAway(59)).toBe('Now');
  });
});

describe('summarizeAlert', () => {
  it('keeps short headers whole', () => {
    expect(summarizeAlert('No [6] at 23 St')).toEqual({ summary: 'No [6] at 23 St', truncated: false });
  });

  it('cuts long headers on a word boundary', () => {
    const header = 'In the Bronx, Woodlawn-bound [4] skips 170 St, Mt Eden Av and 176 St and runs every 16 minutes (days/evenings) while crews replace tracks';
    const { summary, truncated } = summarizeAlert(header);
    expect(truncated).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(121);
    expect(summary.endsWith('…')).toBe(true);
    expect(header.startsWith(summary.slice(0, -1))).toBe(true);
  });
});
