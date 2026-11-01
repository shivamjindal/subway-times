import { describe, expect, it } from 'vitest';
import { boroughOf } from './station-borough';
import { editDistance, scoreName, searchStations } from './station-search';

const names = (query: string, limit = 10) => searchStations(query, limit).map((r) => r.station.name);

describe('editDistance', () => {
  it('counts transpositions as one edit', () => {
    expect(editDistance('tmies', 'times')).toBe(1);
    expect(editDistance('grand', 'grnd')).toBe(1);
  });
});

describe('scoreName', () => {
  it('rejects fuzzy matches on numbers', () => {
    expect(scoreName('8 av', '7 Av')).toBe(0);
  });
  it('ranks exact above prefix above typo', () => {
    const exact = scoreName('canal st', 'Canal St');
    const prefix = scoreName('can', 'Canal St');
    const typo = scoreName('canl', 'Canal St');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThan(0);
  });
});

describe('searchStations', () => {
  it('returns nothing for blank queries', () => {
    expect(searchStations('   ')).toEqual([]);
  });

  it('keeps exact substring behaviour', () => {
    expect(names('Times Sq')[0]).toBe('Times Sq-42 St');
  });

  it('tolerates dropped vowels', () => {
    expect(names('grnd cntrl')[0]).toBe('Grand Central-42 St');
  });

  it('tolerates typos and expands abbreviations', () => {
    expect(names('Tmes Squar').slice(0, 4)).toEqual(Array(4).fill('Times Sq-42 St'));
    expect(names('Tmes Sq')[0]).toBe('Times Sq-42 St');
  });

  it('finds nothing for gibberish', () => {
    expect(names('zzzxq')).toEqual([]);
  });

  it('ranks major hubs first on ambiguous queries', () => {
    expect(names('grand')[0]).toBe('Grand Central-42 St');
    expect(names('42', 8)).toEqual(expect.arrayContaining(['Times Sq-42 St', 'Grand Central-42 St']));
    expect(names('fulton')[0]).toBe('Fulton St');
  });

  it('ranks a closer name match above a bigger hub', () => {
    expect(names('Grand Army')[0]).toMatch(/^Grand Army Plaza/);
  });

  it('keeps duplicate names in stable id order', () => {
    const ids = searchStations('Times Sq', 4).map((r) => r.station.stopId);
    expect(ids).toEqual(['127', '725', '902', 'R16']);
  });

  it('gives duplicate names distinct subtitles', () => {
    for (const query of ['Times Sq', '7 Av']) {
      const subtitles = searchStations(query).filter((r) => r.station.name.startsWith(query));
      expect(new Set(subtitles.map((r) => r.subtitle)).size).toBe(subtitles.length);
    }
    const sevenAv = searchStations('7 Av').filter((r) => r.station.name === '7 Av');
    expect(sevenAv.map((r) => r.subtitle).sort()).toEqual(['Brooklyn · B Q', 'Brooklyn · F FX G', 'Manhattan · B D E']);
  });
});

describe('boroughOf', () => {
  it.each([
    ['Times Sq', 40.75529, -73.987495, 'Manhattan'],
    ['Wall St', 40.7075, -74.0089, 'Manhattan'],
    ['1 Av', 40.7306, -73.9816, 'Manhattan'],
    ['Dyckman St', 40.8605, -73.9255, 'Manhattan'],
    ['Jay St-MetroTech', 40.6923, -73.9873, 'Brooklyn'],
    ['York St', 40.7014, -73.9867, 'Brooklyn'],
    ['Bedford Av', 40.7173, -73.9565, 'Brooklyn'],
    ['Greenpoint Av', 40.7312, -73.9543, 'Brooklyn'],
    ['Coney Island-Stillwell Av', 40.5775, -73.9811, 'Brooklyn'],
    ['Court Sq', 40.7470, -73.9456, 'Queens'],
    ['Queensboro Plaza', 40.7508, -73.9402, 'Queens'],
    ['Flushing-Main St', 40.7596, -73.83, 'Queens'],
    ['Howard Beach', 40.6603, -73.8302, 'Queens'],
    ['3 Av-138 St', 40.8105, -73.9262, 'Bronx'],
    ['Yankee Stadium', 40.8275, -73.9258, 'Bronx'],
    ['Kingsbridge Rd', 40.8669, -73.8975, 'Bronx'],
    ['Tottenville', 40.5126, -74.2514, 'Staten Island'],
  ])('%s is in %s', (_name, lat, lon, expected) => {
    expect(boroughOf(lat as number, lon as number)).toBe(expected);
  });
});
