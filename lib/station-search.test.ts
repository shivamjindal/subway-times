import { describe, expect, it } from 'vitest';
import { searchStationsByName, getAllStations } from './subway-data';
import { getBorough, getStationSubtitle } from './station-search';

const names = (q: string) => searchStationsByName(q).map((r) => r.station.name);

describe('searchStationsByName', () => {
  it('finds stations from abbreviated, vowel-less queries', () => {
    expect(names('grnd cntrl')[0]).toMatch(/^Grand Central/);
  });

  it('finds stations despite dropped letters', () => {
    expect(names('Tmes Squar')[0]).toBe('Times Sq-42 St');
  });

  it('tolerates a transposed typo', () => {
    expect(names('tiems sq')[0]).toBe('Times Sq-42 St');
  });

  it('ranks Grand Central above other Grand stops', () => {
    expect(names('grand')[0]).toMatch(/^Grand Central/);
  });

  it('returns nothing for gibberish and empty input', () => {
    expect(names('zzqxjv')).toEqual([]);
    expect(names('   ')).toEqual([]);
  });

  it('keeps numeric tokens exact-ish', () => {
    const results = names('7 Av');
    expect(results.length).toBeGreaterThan(0);
    expect(results.slice(0, 3).every((n) => n.startsWith('7 Av'))).toBe(true);
  });
});

describe('getStationSubtitle', () => {
  it('distinguishes duplicate station names', () => {
    for (const q of ['Times Sq-42 St', '7 Av']) {
      const dupes = searchStationsByName(q).filter((r) => r.station.name === q);
      expect(dupes.length).toBeGreaterThan(1);
      const subtitles = dupes.map(getStationSubtitle);
      expect(new Set(subtitles).size).toBe(dupes.length);
    }
  });

  it('classifies boroughs of known stations', () => {
    const borough = (name: string, line: string) => {
      const s = getAllStations().find((x) => x.station.name === name && x.routes.some((r) => r.shortName === line))!;
      return getBorough(s.station);
    };
    expect(borough('Grand Central-42 St', '4')).toBe('Manhattan');
    expect(borough('161 St-Yankee Stadium', '4')).toBe('Bronx');
    expect(borough('Jay St-MetroTech', 'A')).toBe('Brooklyn');
    expect(borough('Flushing-Main St', '7')).toBe('Queens');
  });
});
