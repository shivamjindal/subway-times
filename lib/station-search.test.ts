import { describe, expect, it } from 'vitest';
import { getBorough, searchStations, describeStation } from './station-search';

const names = (q: string) => searchStations(q).map((m) => m.station.name);

describe('searchStations', () => {
  it('finds stations despite typos and abbreviations', () => {
    expect(names('grnd cntrl')[0]).toBe('Grand Central-42 St');
    expect(names('Tmes Squar')[0]).toBe('Times Sq-42 St');
    expect(names('tims sq')[0]).toBe('Times Sq-42 St');
    expect(names('Atlantc Av')[0]).toMatch(/^Atlantic Av/);
  });

  it('keeps plain substring matches', () => {
    expect(names('times sq')[0]).toBe('Times Sq-42 St');
    expect(names('42 st').length).toBeGreaterThan(3);
  });

  it('locks the first Times Sq station (127) first', () => {
    expect(searchStations('Times Sq')[0].station.stopId).toBe('127');
  });

  it('ranks major hubs above single-line stops on equal matches', () => {
    expect(names('42 st').slice(0, 3)).toContain('Times Sq-42 St');
  });

  it('puts an exact name first', () => {
    expect(names('7 av')[0]).toBe('7 Av');
  });

  it('does not fuzz numbers', () => {
    expect(names('43 st').every((n) => !n.startsWith('Times Sq'))).toBe(true);
  });

  it('returns nothing for gibberish and empty queries', () => {
    expect(searchStations('zzqx')).toEqual([]);
    expect(searchStations('   ')).toEqual([]);
  });

  it('lists stations on a line when the query is a line name', () => {
    const results = searchStations('7');
    expect(results.some((m) => m.station.name === 'Flushing-Main St')).toBe(true);
  });
});

describe('borough subtitle', () => {
  it.each([
    ['Times Sq-42 St', 'Manhattan'],
    ['Grand Central-42 St', 'Manhattan'],
    ['Flushing-Main St', 'Queens'],
    ['Jay St-MetroTech', 'Brooklyn'],
    ['Coney Island-Stillwell Av', 'Brooklyn'],
    ['161 St-Yankee Stadium', 'Bronx'],
    ['Fordham Rd', 'Bronx'],
    ['Bedford Park Blvd', 'Bronx'],
    ['Bowling Green', 'Manhattan'],
    ['Court Sq', 'Queens'],
    ['Greenpoint Av', 'Brooklyn'],
    ['Grant Av', 'Brooklyn'],
    ['Woodhaven Blvd', 'Queens'],
  ])('%s is in %s', (name, borough) => {
    const hit = searchStations(name).find((m) => m.station.name === name)!;
    expect(hit.borough).toBe(borough);
  });

  it('places Staten Island and distinguishes duplicate names', () => {
    expect(getBorough({ lat: 40.6366, lon: -74.0748 })).toBe('Staten Island');
    const sevenAv = searchStations('7 Av').filter((m) => m.station.name === '7 Av');
    expect(new Set(sevenAv.map(describeStation)).size).toBe(sevenAv.length);
  });
});
