import { describe, expect, it } from 'vitest';
import { isLongAlert } from './alert-summary';

describe('isLongAlert', () => {
  it('keeps short header-only alerts expanded', () => {
    expect(isLongAlert({ headerText: 'Delays on the A', descriptionText: '' })).toBe(false);
    expect(isLongAlert({ headerText: 'Delays on the A', descriptionText: '   ' })).toBe(false);
  });

  it('collapses alerts with a description', () => {
    expect(isLongAlert({ headerText: 'Delays on the A', descriptionText: 'Trains are running slower.' })).toBe(true);
  });

  it('collapses alerts with a long header', () => {
    expect(isLongAlert({ headerText: 'x'.repeat(81), descriptionText: '' })).toBe(true);
  });
});
