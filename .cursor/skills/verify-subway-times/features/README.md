# subway-times features

User-facing features and how to verify each with this skill's harness. The harness is `scripts/drive.mjs`, headless Chrome over CDP.

| Feature | File | Journey | Launch |
|---|---|---|---|
| Live network map: every train a rocket, ticker, collapse | [live-network-map.md](live-network-map.md) | `drive.mjs map` | `launch.sh` (dev OK) |
| Spaceport close-up, e.g. Times Sq-42 St | [spaceport-closeup.md](spaceport-closeup.md) | `drive.mjs closeup`, `drive.mjs card-closeup` | `launch.sh --prod` (required) |
| Station search, tracking, and station cards | [station-search.md](station-search.md) | `drive.mjs search` | `launch.sh` (dev OK) |
| Feedback page → `/api/feedback` → Apps Script | [feedback.md](feedback.md) | `drive.mjs feedback` | `launch.sh` (mock webhook) |

Each file has the same sections: Sub-features, How to get to it (user POV), Driving it with drive.mjs, and Gotchas.
When you add a feature, add a file and a journey. Never loosen an assertion to make a journey pass. A failing journey is a finding, so record it under that feature's Gotchas.
