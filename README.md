# EMSA World Cup 2026 — League Dashboard

Live combined leaderboard for the EMSA bracket pool (group + knockout). Hosted on
GitHub Pages: https://abrodkey.github.io/emsa-wc-2026/

## How it works

`index.html` is a single self-contained page. It embeds every player's picks and
computes everything **live in the browser** from public ESPN feeds — no server,
no cron, no API key:

- **Group + knockout results** come from the public `fifa.world` scoreboard feed
  (`site.api.espn.com/.../scoreboard`), recomputed every ~30s while a match is live
  (≈2 min otherwise, instant on tab focus). Group tables use FIFA tiebreakers;
  knockout rounds are classified by counting each team's knockout matches, and
  winners use the feed's winner flag (penalties included).
- **Picks** are embedded: Phase-1 group picks from the Google-Form CSV (emails
  stripped), and Phase-2 knockout picks in `knockout.json` (built from the public
  ESPN gambit bracket-challenge API — see `build-knockout.mjs`).
- **`overrides.json`** holds the few results no feed can know: `champion` (final
  override), `goldenBall` (FIFA's subjective award — set manually), and optional
  `thirds`.

## Scoring

**Group stage** (locked): 1st 3 · 2nd 3 · 3rd 2 · 4th 1 · advancing-3rd qualifier 2 ·
pre-tournament Winner 15 · Golden Boot 7.
**Knockout:** Round of 16 pick 3 · Quarterfinal 5 · Semifinal 7 · Champion 10
(→ **25 combined** with the group Winner guess) · Golden Ball 7.
**Tiebreaker:** closest guess to total tournament goals.

The leaderboard total combines both; the per-row bar breaks points into group stage,
knockout stage, champion (stage 1 / stage 2), golden boot, and golden ball.

## Rebuilding knockout picks

Picks lock when the knockouts begin. To (re)generate `knockout.json` from the form
links + ESPN gambit API:

```
node build-knockout.mjs     # reads the two CSVs in ~/Downloads, writes knockout.json
```

Then re-embed it into `index.html` (the `<script id="koseed">` block) and commit.

Player **emails are never published** — only names and bracket names appear.
