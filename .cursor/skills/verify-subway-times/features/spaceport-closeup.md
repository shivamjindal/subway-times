# Spaceport close-up

## Sub-features

- A modal `<dialog>` (`aria-labelledby="spaceport-title"`) re-creating a spaceport's landings and launches. A spaceport is a station or a transfer complex. Times Sq-42 St groups 127 (1/2/3), 725 (7), 902 (S), and R16 (N/Q/R/W), plus the A/C/E stop, for 10 platforms.
- Pads: one per platform, split further per NYCT track when the feed carries tracks. `[data-testid=pad-count]` reads e.g. `13 pads · one per platform and track` on live and `10 pads · one per platform` without tracks (the mock).
- Live mode follows real landings and launches. "Next landing" and "Next launch" T-minus countdowns, plus `[data-testid=pad-phase]` (e.g. `2 on pad · 1 landing` or `All pads clear`).
- Replay plays the sequence on demand, and Loop repeats it.
- "Manifest by pad" (`[data-testid=pad-manifest]`) has one `li[data-pad]` per platform, not per track.
- "Track spaceport" appears when the spaceport isn't tracked. Close with the X (`aria-label="Close spaceport"`) or Escape.
- Reduced motion shows a still hero frame. No WebGL shows a text manifest only.

## How to get to it (user POV)

1. On `/`, type "Times Sq" into the search box and press Enter (or click a "Times Sq-42 St" result).
2. In the map sidebar under "Tracked spaceports", click "Times Sq-42 St". The sidebar shows "Target locked" and the camera flies there.
3. Click "Enter spaceport".

You can also click a spaceport or rocket on the canvas, which calls the same handler.

## Driving it with drive.mjs

```bash
.cursor/skills/verify-subway-times/scripts/launch.sh --prod     # dev does not work, see Gotchas
node .cursor/skills/verify-subway-times/scripts/drive.mjs closeup
```

The journey runs these steps:

1. It clears `selectedStations`, waits for map rockets, then adds Times Sq via search + Enter. It asserts `localStorage` has `"127"`, the station card `h2` reads "Times Sq-42 St", and `/api/subway-times?stations=127` returns 200.
2. It clicks the tracked spaceport button and asserts "Target locked" (`closeup-target-locked.png`).
3. It clicks "Enter spaceport" and asserts the `dialog[open] #spaceport-title` is "Times Sq-42 St", pad count ≥ 10, and exactly 10 manifest rows.
4. It asserts a canvas is inside the `Close-up of the Times Sq-42 St spaceport…` image and `pad-phase` has text. It also asserts the manifest has timed entries (or the "Nothing inbound" note), taking `closeup-live.png`.
5. After 8 s it re-reads `pad-phase` and the countdowns (`closeup-live-8s.png`).
6. It clicks Replay, asserts the status shows "Replay", and after 4 s takes `closeup-replay.png`.
7. It clicks "Close spaceport" and asserts no `dialog[open]` remains.

## Gotchas

- **Under `npm run dev` the close-up never stays open.** Clicking "Enter spaceport" opens the dialog, and about 25 ms later a `close` event dismisses it. A MutationObserver probe saw `open` at 3460 ms and `close` at 3485 ms.
  - The cause is React StrictMode double-running the mount effect in `components/orbital-map/spaceport-closeup.tsx` (about line 74). The cleanup calls `dialog.close()`, which queues a `close` event, and that event fires `onClose` after the remount.
  - It works under `next build` + `next start`, because StrictMode doesn't double-invoke in production. **Always launch with `--prod` for this journey.**
  - The bug isn't fixed yet. On dev, the journey fails at "timed out … waiting for close-up dialog" (or "…close-up scene" if the poll catches the dialog in its brief open moment). That failure is expected until the fix lands, so don't loosen the journey to accept it.
- Pad count differs between live and mock, because only live carries NYCT tracks. Assert `≥ 10` pads and exactly 10 manifest rows, never a fixed pad total.
- `pad-phase` can read "All pads clear" while a landing is seconds away. The countdowns are the better live signal, and Replay is the deterministic one.
- On a quiet spaceport, live mode shows "Nothing inbound in the next 20 minutes. Press Replay…". Times Sq is never quiet on weekday daytime live data. Use `--rush` for a guaranteed busy apron offline.
- The map pauses rendering while the close-up is open, so `__spaceNetworkPerf` stops updating. Don't use it as a liveness check here.
- The close-up scene is lazy-loaded separately ("Rolling out the pad…"). Allow up to 60 s on a cold prod start.
