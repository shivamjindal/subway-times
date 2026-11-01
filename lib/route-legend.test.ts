import { describe, expect, it } from 'vitest';
import { getDirectionName, getRouteKeyCaption, isExpressRoute } from './route-legend';

describe('isExpressRoute', () => {
  it('flags X routes only', () => {
    expect(isExpressRoute('6X')).toBe(true);
    expect(isExpressRoute('7X')).toBe(true);
    expect(isExpressRoute('X')).toBe(false);
    expect(isExpressRoute('6')).toBe(false);
  });
});

describe('getRouteKeyCaption', () => {
  it('explains express routes', () => {
    expect(getRouteKeyCaption('6X')).toContain('express version of the 6');
  });

  it('keeps local routes plain', () => {
    expect(getRouteKeyCaption('A')).toBe('A train');
  });
});

describe('getDirectionName', () => {
  it('maps N and S to Uptown and Downtown', () => {
    expect(getDirectionName('N')).toBe('Uptown');
    expect(getDirectionName('S')).toBe('Downtown');
  });
});
