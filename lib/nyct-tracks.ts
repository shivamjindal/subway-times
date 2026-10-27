/**
 * Reads the NYCT GTFS-realtime extension (NyctStopTimeUpdate, field 1001 on TripUpdate.StopTimeUpdate):
 * `scheduled_track` (1) is the planned track for each stop; `actual_track` (2) is only set for the next stop,
 * shortly before arrival, and differs from the scheduled track when a train is rerouted.
 * gtfs-realtime-bindings drops unknown fields, so this walks the raw protobuf.
 */
export interface StopTrack {
  scheduled?: string;
  actual?: string;
}

/** tripId -> GTFS stop ID -> track */
export type TrackIndex = Map<string, Map<string, StopTrack>>;

export interface TrackCoverage {
  stopUpdates: number;
  scheduled: number;
  actual: number;
  /** Stops where the actual track differs from the scheduled one. */
  rerouted: number;
}

const NYCT_STOP_TIME_UPDATE = 1001;
const decoder = new TextDecoder();

class Reader {
  pos: number;
  constructor(
    private buf: Uint8Array,
    start: number,
    readonly end: number
  ) {
    this.pos = start;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end) throw new RangeError('truncated varint');
      const byte = this.buf[this.pos++];
      // Field tags and lengths fit in 53 bits; larger varints (int64 times) are skipped, not used.
      if (shift < 49) result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
      shift += 7;
    }
  }

  /** Returns [field, wireType], or null at the end. */
  tag(): [number, number] | null {
    if (this.pos >= this.end) return null;
    const tag = this.varint();
    return [Math.floor(tag / 8), tag & 7];
  }

  sub(): Reader {
    const length = this.varint();
    const start = this.pos;
    this.pos += length;
    if (this.pos > this.end) throw new RangeError('truncated field');
    return new Reader(this.buf, start, start + length);
  }

  string(): string {
    const r = this.sub();
    return decoder.decode(this.buf.subarray(r.pos, r.end));
  }

  skip(wireType: number) {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.pos += 8;
    else if (wireType === 2) this.sub();
    else if (wireType === 5) this.pos += 4;
    else throw new RangeError(`unsupported wire type ${wireType}`);
  }
}

function readTrack(r: Reader): StopTrack {
  const track: StopTrack = {};
  for (let t = r.tag(); t; t = r.tag()) {
    const [field, wire] = t;
    if (field === 1 && wire === 2) track.scheduled = r.string();
    else if (field === 2 && wire === 2) track.actual = r.string();
    else r.skip(wire);
  }
  return track;
}

function readStopTimeUpdate(r: Reader): { stopId?: string; track?: StopTrack } {
  let stopId: string | undefined;
  let track: StopTrack | undefined;
  for (let t = r.tag(); t; t = r.tag()) {
    const [field, wire] = t;
    if (field === 4 && wire === 2) stopId = r.string();
    else if (field === NYCT_STOP_TIME_UPDATE && wire === 2) track = readTrack(r.sub());
    else r.skip(wire);
  }
  return { stopId, track };
}

function readTripId(r: Reader): string | undefined {
  for (let t = r.tag(); t; t = r.tag()) {
    const [field, wire] = t;
    if (field === 1 && wire === 2) return r.string();
    r.skip(wire);
  }
  return undefined;
}

function readTripUpdate(r: Reader, index: TrackIndex, coverage: TrackCoverage) {
  let tripId: string | undefined;
  const stops = new Map<string, StopTrack>();
  for (let t = r.tag(); t; t = r.tag()) {
    const [field, wire] = t;
    if (field === 1 && wire === 2) tripId = readTripId(r.sub());
    else if (field === 2 && wire === 2) {
      const { stopId, track } = readStopTimeUpdate(r.sub());
      coverage.stopUpdates++;
      if (!stopId || !track) continue;
      if (track.scheduled) coverage.scheduled++;
      if (track.actual) coverage.actual++;
      if (track.actual && track.scheduled && track.actual !== track.scheduled) coverage.rerouted++;
      if (track.scheduled || track.actual) stops.set(stopId, track);
    } else r.skip(wire);
  }
  if (tripId && stops.size > 0 && !index.has(tripId)) index.set(tripId, stops);
}

/** Adds every trip's per-stop tracks from one raw FeedMessage to `index`. Malformed input is ignored, not thrown. */
export function readNyctTracks(buf: Uint8Array, index: TrackIndex, coverage: TrackCoverage) {
  try {
    const feed = new Reader(buf, 0, buf.length);
    for (let t = feed.tag(); t; t = feed.tag()) {
      const [field, wire] = t;
      if (field !== 2 || wire !== 2) {
        feed.skip(wire);
        continue;
      }
      const entity = feed.sub();
      for (let e = entity.tag(); e; e = entity.tag()) {
        const [entityField, entityWire] = e;
        if (entityField === 3 && entityWire === 2) readTripUpdate(entity.sub(), index, coverage);
        else entity.skip(entityWire);
      }
    }
  } catch (err) {
    console.warn('Could not read NYCT track extension:', err instanceof Error ? err.message : err);
  }
}

export function emptyTrackCoverage(): TrackCoverage {
  return { stopUpdates: 0, scheduled: 0, actual: 0, rerouted: 0 };
}

/** The track a train uses at a stop: actual when the feed has confirmed it, otherwise scheduled. */
export function trackAt(index: TrackIndex | undefined, tripId: string, stopId: string): string | undefined {
  const track = index?.get(tripId)?.get(stopId);
  return track?.actual ?? track?.scheduled;
}
