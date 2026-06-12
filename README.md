# EMSA World Cup 2026 — League Dashboard

A live leaderboard for the EMSA bracket pool. Open `index.html` (or the hosted
GitHub Pages link) to see standings; scores update automatically every 10 minutes.

## How it works

```
ESPN fifa.world feed  ──►  update-scores.mjs  ──►  results.json  ──►  index.html
   (live match scores)      (computes tables)      (published)        (leaderboard)
```

- **`update-scores.mjs`** pulls group-stage results from ESPN's free `fifa.world`
  feed (no API key), computes each group's table with FIFA tiebreakers
  (best-effort), works out the 8 best third-place qualifiers once every group is
  final, merges any manual corrections from `overrides.json`, and writes
  `results.json`.
- **`.github/workflows/update-scores.yml`** runs that script **every 10 minutes** on
  GitHub's servers and commits `results.json` when scores change — so the board
  stays current even when nobody has it open.
- **`index.html`** is a self-contained dashboard. It has every bracket embedded,
  fetches `results.json` on load (and every 10 min), and re-scores everyone live.
  Player email addresses are **not** included in the published page.

## Scoring (group-stage phase)

| Event | Points |
|---|---|
| Exact group placement (per team) | 3 |
| Correct 3rd-place qualifier (per team) | 4 |
| Tournament champion | 25 |
| Golden Boot | 15 |

Points from a group **lock** once that group is final; before that the group's
contribution is provisional and moves as games are played.

## Making manual corrections

Everything the live feed can't know lives in **`overrides.json`** and is applied
on top of the auto-computed scores every run:

- `champion` — set to a team name once the final is played, e.g. `"Spain"`.
- `boot` — set to a scorer, e.g. `"Kylian Mbappé"` (matching is last-name based).
- `eliminated` — array of team names knocked out in the knockouts (flips a
  bracket's champion pick to "eliminated").
- `standings` — `{ "C": { "Brazil": 1, "Morocco": 2, ... } }` to override a
  group if the auto tiebreaker ever gets an edge case wrong.
- `thirds` — array of 8 team names to override the qualifier set.

Edit the file (GitHub web UI works), commit, and the next run picks it up. You
can also trigger a run immediately from the **Actions** tab → *Update WC scores*
→ *Run workflow*.

## Coming later

Knockout-bracket scoring (Round of 32 → Final) will be layered on once those
picks are collected.
