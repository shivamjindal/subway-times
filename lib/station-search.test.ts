import { describe, expect, it } from 'vitest';
import { getAllStations } from './subway-data';
import { fuzzySearchStations, getBorough, getStationSubtitle } from './station-search';

const names = (q: string) => fuzzySearchStations(q).map((r) => r.station.name);

describe('fuzzySearchStations', () => {
  it('matches abbreviations and typos', () => {
    expect(names('grnd cntrl')[0]).toBe('Grand Central-42 St');
    expect(names('Tmes Squar')[0]).toBe('Times Sq-42 St');
    expect(names('times sq')[0]).toBe('Times Sq-42 St');
  });

  it('ranks major hubs first', () => {
    expect(names('grand')[0]).toBe('Grand Central-42 St');
    expect(names('times')[0]).toBe('Times Sq-42 St');
  });

  it('keeps numeric tokens exact', () => {
    expect(names('7 av').every((n) => /\b7 Av\b|7 Av/.test(n))).toBe(true);
    expect(names('42').some((n) => n.includes('242'))).toBe(false);
  });

  it('returns nothing for gibberish', () => {
    expect(names('zzqxj')).toEqual([]);
    expect(names('asdfgh')).toEqual([]);
    expect(names('   ')).toEqual([]);
  });
});

describe('subtitles', () => {
  it('derives boroughs', () => {
    expect(getBorough(40.7527, -73.9772)).toBe('Manhattan');
    expect(getBorough(40.6842, -73.9778)).toBe('Brooklyn');
    expect(getBorough(40.7471, -73.9456)).toBe('Queens');
    expect(getBorough(40.8183, -73.9272)).toBe('Bronx');
    expect(getBorough(40.6436, -74.0735)).toBe('Staten Island');
  });

  it('distinguishes the four Times Sq rows', () => {
    const rows = getAllStations().filter((s) => s.station.name === 'Times Sq-42 St');
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map(getStationSubtitle)).size).toBe(4);
    rows.forEach((r) => expect(getStationSubtitle(r)).toMatch(/^Manhattan · /));
  });

  it('distinguishes the 7 Av rows', () => {
    const rows = getAllStations().filter((s) => s.station.name === '7 Av');
    expect(new Set(rows.map(getStationSubtitle)).size).toBe(rows.length);
  });
});
