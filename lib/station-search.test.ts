import { describe, expect, it } from 'vitest';
import { editDistance, getStationBorough, searchStations, tokenScore, tokenize } from './station-search';

const names = (query: string, limit?: number) => searchStations(query, limit).map((r) => r.station.name);

describe('tokenize', () => {
  it('maps spelled-out words and ordinals to the GTFS short forms', () => {
    expect(tokenize('42nd Street & 8th Avenue')).toEqual(['42', 'st', '8', 'av']);
    expect(tokenize('Times Square')).toEqual(['times', 'sq']);
    expect(tokenize("Prince St / B'way")).toEqual(['prince', 'st', 'bway']);
  });
});

describe('tokenScore', () => {
  it('prefers exact over prefix over typo matches', () => {
    expect(tokenScore('times', 'times')).toBe(1);
    expect(tokenScore('tim', 'times')).toBe(0.9);
    expect(tokenScore('cntrl', 'central')).toBe(0.75);
    expect(tokenScore('tiems', 'times')).toBe(0.7);
  });

  it('never fuzzes numbers or very short words', () => {
    expect(tokenScore('7', '1')).toBe(0);
    expect(tokenScore('42', '43')).toBe(0);
    expect(tokenScore('4', '42')).toBe(0.9);
    expect(tokenScore('xy', 'xz')).toBe(0);
  });

  it('counts a transposition as one edit', () => {
    expect(editDistance('tiems', 'times')).toBe(1);
    expect(editDistance('grand', 'grand')).toBe(0);
  });
});

describe('searchStations matching', () => {
  it('finds stations despite dropped letters and typos', () => {
    expect(names('grnd cntrl')[0]).toBe('Grand Central-42 St');
    expect(names('Tmes Squar')[0]).toBe('Times Sq-42 St');
    expect(names('unoin sq')[0]).toBe('14 St-Union Sq');
    expect(names('atlantc av')[0]).toBe('Atlantic Av-Barclays Ctr');
  });

  it('treats St/Street, Av/Avenue and Sq/Square as the same word', () => {
    expect(names('Times Square')[0]).toBe('Times Sq-42 St');
    expect(names('7 Avenue')).toEqual(names('7 Av'));
    expect(names('34th street penn station')[0]).toBe('34 St-Penn Station');
  });

  it('requires every query word to match', () => {
    expect(names('7 Av')).not.toContain('1 Av');
    expect(names('grand central').every((n) => /grand/i.test(n) && /central/i.test(n))).toBe(true);
  });

  it('returns nothing for gibberish or an empty query', () => {
    expect(searchStations('zzqx')).toEqual([]);
    expect(searchStations('   ')).toEqual([]);
    expect(searchStations('station')).toEqual([]);
  });
});

describe('searchStations ranking', () => {
  it('ranks major hubs first for a shared word', () => {
    expect(new Set(names('34 st', 4))).toEqual(new Set(['34 St-Herald Sq', '34 St-Penn Station']));
    expect(names('fulton')[0]).toBe('Fulton St');
    expect(names('14 st', 4)).toContain('14 St-Union Sq');
  });

  it('puts an exact name ahead of a hub that only partly matches', () => {
    expect(names('7 av', 3)).toEqual(['7 Av', '7 Av', '7 Av']);
  });

  it('keeps the data order within a complex, so Enter on "Times Sq" still locks 127', () => {
    const times = searchStations('times sq').filter((r) => r.station.name === 'Times Sq-42 St');
    expect(times.length).toBe(4);
    expect(times[0].station.stopId).toBe('127');
  });
});

describe('getStationBorough', () => {
  it('disambiguates duplicate names', () => {
    const sevenAv = searchStations('7 av', 3).map((r) => getStationBorough(r.station.stopId));
    expect(sevenAv.sort()).toEqual(['Brooklyn', 'Brooklyn', 'Manhattan']);
    expect(getStationBorough('127')).toBe('Manhattan');
    expect(getStationBorough('222')).toBe('Bronx');
  });
});
