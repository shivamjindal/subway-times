import { describe, expect, it } from 'vitest';
import { summarizeAlerts } from './alert-summary';

describe('summarizeAlerts', () => {
  it('returns an empty string without alerts', () => {
    expect(summarizeAlerts([])).toBe('');
  });

  it('collapses whitespace and counts the remaining alerts', () => {
    expect(summarizeAlerts([{ headerText: 'Trains are\n running  slow' }, { headerText: 'b' }, { headerText: 'c' }])).toBe(
      'Trains are running slow (+2 more)'
    );
  });

  it('truncates long headers to a single line', () => {
    const summary = summarizeAlerts([{ headerText: 'x'.repeat(300) }]);
    expect(summary.length).toBeLessThanOrEqual(90);
    expect(summary.endsWith('…')).toBe(true);
  });
});
