import type { Pad, Spaceport } from '@/lib/spaceports';
import { berthTrack, type Fleet } from './rocket-timeline';

/** One landing site in the close-up: a berth of one of the spaceport's pads, placed on the apron (metres). */
export interface Site {
  berth: string;
  pad: Pad;
  track?: string;
  label: string;
  x: number;
  z: number;
}

export const PAD_RADIUS = 5.2;
const SITE_SPACING = 12.5;
const BLOCK_GAP = 5;

/**
 * Each station is a block: its northbound berths in a back row, southbound in front, so a platform pair lines up
 * (or side by side when each direction has one berth). Blocks pack into a roughly 1.6:1 grid, widest first.
 * Returns the sites and the apron's radius.
 */
export function layoutSites(spaceport: Spaceport, fleet: Fleet): { sites: Site[]; radius: number } {
  const blocks = spaceport.stationIds
    .map((stationId) => {
      const rows: Site[][] = [[], []];
      for (const pad of spaceport.pads.filter((p) => p.stationId === stationId)) {
        const berths = fleet.berths.get(pad.id) ?? [pad.id];
        for (const berth of berths) {
          const track = berthTrack(berth);
          const label = track && berths.length > 1 ? `${pad.label} · Trk ${track}` : pad.label;
          rows[pad.direction === 'N' ? 0 : 1].push({ berth, pad, track, label, x: 0, z: 0 });
        }
      }
      const grid = rows[0].length <= 1 && rows[1].length <= 1 ? [[...rows[0], ...rows[1]]] : rows.filter((r) => r.length > 0);
      return { grid, cols: Math.max(...grid.map((r) => r.length)), depth: grid.length };
    })
    .filter((b) => b.cols > 0)
    .sort((a, b) => b.cols * b.depth - a.cols * a.depth);

  const cells = blocks.reduce((n, b) => n + b.cols * b.depth, 0);
  const maxCols = Math.max(Math.ceil(Math.sqrt(cells * 1.6)), ...blocks.map((b) => b.cols));
  const sites: Site[] = [];
  let x = 0;
  let z = 0;
  let rowDepth = 0;
  let rowCols = 0;
  for (const block of blocks) {
    if (rowCols > 0 && rowCols + block.cols > maxCols) {
      z += rowDepth * SITE_SPACING + BLOCK_GAP;
      x = 0;
      rowCols = 0;
      rowDepth = 0;
    }
    block.grid.forEach((row, r) => {
      row.forEach((site, c) => {
        site.x = x + c * SITE_SPACING;
        site.z = z + r * SITE_SPACING;
        sites.push(site);
      });
    });
    x += block.cols * SITE_SPACING + BLOCK_GAP;
    rowCols += block.cols;
    rowDepth = Math.max(rowDepth, block.depth);
  }

  const xs = sites.map((s) => s.x);
  const zs = sites.map((s) => s.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  for (const site of sites) {
    site.x -= cx;
    site.z -= cz;
  }
  const radius = sites.reduce((max, s) => Math.max(max, Math.hypot(s.x, s.z)), 0) + PAD_RADIUS;
  return { sites, radius };
}

export type PadPhase = 'awaiting' | 'entry' | 'holding' | 'landing-burn' | 'touchdown' | 'on-pad' | 'ignition' | 'liftoff' | 'climb-out';

export const PHASE_LABELS: Record<PadPhase, string> = {
  awaiting: 'Pad clear',
  entry: 'Entry · grid fins',
  holding: 'Holding · pad busy',
  'landing-burn': 'Landing burn',
  touchdown: 'Touchdown',
  'on-pad': 'On pad · venting',
  ignition: 'Ignition',
  liftoff: 'Liftoff',
  'climb-out': 'Climb-out',
};

/** Rockets per activity across all of a spaceport's sites, as drawn in the close-up. */
export interface ApronStatus {
  landing: number;
  holding: number;
  onPad: number;
  launching: number;
}

export function describeApron(status: ApronStatus): string {
  const parts = [
    status.landing && `${status.landing} landing`,
    status.holding && `${status.holding} holding`,
    status.onPad && `${status.onPad} on pad`,
    status.launching && `${status.launching} launching`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'All pads clear';
}
