# Windows test tools (Playwright 1.63)

Install once in any scratch folder: `npm install playwright@1.63.0` (browsers from
`%LOCALAPPDATA%\ms-playwright`). Serve the release ZIP locally with
`py -3 -I serve.py <unzipped-release-dir> 4317`, or use the source dev server.

- `node playthrough.mjs <chromium|msedge|webkit> <0|1|rand> <outdir> [minutes] [baseUrl]`
  plays the whole story (choices, deductions, native combats) and writes
  `report.json`, `log.txt` and screenshots. `chromium`/`msedge` use the GPU (ANGLE D3D11).
- `node regress-f1f2f3.mjs <baseUrl>` checks F1 (Space after closing a panel) and
  F2 (scene scroll on scrollIntoView / Tab).
- `[SM_RUNTIME=<runtime.json>] node regress-extra.mjs <baseUrl>` checks keyboard focus restore, Skip/Menu/House
  pointer paths and F3 (page hidden for 25 s during the native start).

- `node f3-never-ready.mjs <baseUrl>` blocks `sm-combat-ready` on a visible page and expects the start error after the visible budget.

Local only; never point these at production with real player data.
