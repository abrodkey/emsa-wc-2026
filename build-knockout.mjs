#!/usr/bin/env node
/**
 * EMSA World Cup 2026 — Phase 2 knockout ingest.
 *
 * Reads the knockout Google-Form CSV (links → ESPN entry IDs, Golden Ball, tiebreak)
 * and the Phase-1 picks CSV (for the canonical/old bracket name, joined by player
 * name), pulls each player's locked bracket from ESPN's public gambit API, decodes
 * the picks into team names grouped by round, and writes knockout.json.
 *
 * Picks are locked once the knockouts begin, so this is run once (re-run if needed).
 * Run from the repo root:  node build-knockout.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const SLUG = "mens-knockout-bracket-challenge-2026";
const HOME = process.env.HOME;
const KO_CSV = `${HOME}/Downloads/EMSA World Cup 26 Pool - KNOCKOUT STAGE.csv`;
const P1_CSV = `${HOME}/Downloads/EMSA WC Picks Tracker - Picks Tracker.csv`;

// players who submitted a bad/no link — supply the entry id manually
const ENTRY_OVERRIDE = { "Rachel Connors": "9958a000-730c-11f1-b737-afe15b1d72bc" };
// knockout-name -> Phase-1 full name, where last-name matching isn't enough
const NAME_ALIAS = { "James": "James Noyes", "Moni": "Monica Dick", "CJ": "CJ Jones" };
// Golden Ball / Golden Boot canonical keys (last-name match, accent-insensitive)
const PLAYER_KEYS = ["messi","mbappe","kane","dembele","bellingham","vinicius","pulisic","haaland","yamal","ronaldo","alvarez"];

function parseCSV(t){const rows=[];let i=0,f="",row=[],q=false;while(i<t.length){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i+=2;continue;}q=false;i++;continue;}f+=c;i++;continue;}if(c==='"'){q=true;i++;continue;}if(c===','){row.push(f);f="";i++;continue;}if(c==='\r'){i++;continue;}if(c==='\n'){row.push(f);rows.push(row);row=[];f="";i++;continue;}f+=c;i++;}if(f.length||row.length){row.push(f);rows.push(row);}return rows;}
const norm = s => (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z ]/g," ").replace(/\s+/g," ").trim();
const playerKey = s => { const n=norm(s); for(const k of PLAYER_KEYS) if(n.includes(k)) return k; return n; };
const entryIdOf = url => { if(!url) return null; const m=url.match(/entryId=([0-9a-f-]+)/)||url.match(/[?&]id=([0-9a-f-]+)/); return m?m[1]:null; };

// ---- Phase-1 names -> bracket ----
const p1 = parseCSV(readFileSync(P1_CSV,"utf8")).filter(r=>r.length>5).slice(1).filter(r=>r[2]&&r[2].trim())
  .map(r=>({ full:r[2].trim(), bracket:(r[3]||r[2]).trim() }));
const last = s => norm(s).split(" ").slice(-1)[0], first = s => norm(s).split(" ")[0];
function matchPhase1(koName){
  const alias = NAME_ALIAS[koName.trim()] || koName.trim();
  let m = p1.find(x=>norm(x.full)===norm(alias));
  if(!m) m = p1.find(x=>first(x.full)===first(alias) && last(x.full)===last(alias));
  if(!m){ const c=p1.filter(x=>last(x.full)===last(alias)); if(c.length===1) m=c[0]; }
  return m;
}

// ---- gambit propositions: propId -> round, outcomeId -> team ----
const PER = {1:"R32",2:"R16",3:"QF",4:"SF",5:"FINAL"};
const roundOf = {}, teamOf = {};
for(const sp of [1,2,3,4,5]){
  const ch = await (await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${SLUG}?scoringPeriodId=${sp}&platform=chui&view=chui_default`)).json();
  for(const p of (ch.propositions||[])){ roundOf[p.id]=PER[p.scoringPeriodId]; (p.possibleOutcomes||[]).forEach(o=>teamOf[o.id]=o.description); }
}

// ---- knockout CSV -> entries ----
const ko = parseCSV(readFileSync(KO_CSV,"utf8")).filter(r=>r.length>=7 && /^2026\//.test(r[0]||""));
const entries=[]; const problems=[];
for(const r of ko){
  const koName=r[2].trim();
  const eid = ENTRY_OVERRIDE[koName] || entryIdOf(r[4]);
  const p1m = matchPhase1(koName);
  if(!eid){ problems.push(`no entryId for ${koName}`); continue; }
  if(!p1m){ problems.push(`no Phase-1 match for ${koName}`); continue; }
  const en = await (await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${SLUG}/entries/${eid}`)).json();
  const picks={R32:[],R16:[],QF:[],SF:[],FINAL:[]};
  for(const pk of (en.picks||[])){
    const rnd=roundOf[pk.propositionId]; const team=teamOf[(pk.outcomesPicked&&pk.outcomesPicked[0]||{}).outcomeId];
    if(rnd&&team) picks[rnd].push(team);
  }
  const tb = (r[6]||"").trim();
  entries.push({
    name: p1m.full,
    bracket: p1m.bracket,                    // canonical Phase-1 (old) bracket name
    entryId: eid,
    r16: picks.R16, qf: picks.QF, sf: picks.SF, champion: picks.FINAL[0]||null, r32: picks.R32,
    goldenBall: (r[5]||"").trim(),
    goldenBallKey: playerKey(r[5]),
    tiebreak: tb ? Number(tb) : 300        // Gerardo (blank) -> 300
  });
}

entries.sort((a,b)=>a.bracket.localeCompare(b.bracket));
const out = { generated:new Date().toISOString(), season:"2026 FIFA World Cup", source:"ESPN gambit knockout-bracket-challenge", count:entries.length, entries };
writeFileSync(`${process.cwd().endsWith("emsa-wc-2026")?".":"emsa-wc-2026"}/knockout.json`, JSON.stringify(out,null,2));
console.log(`Wrote knockout.json — ${entries.length} entries.`);
if(problems.length) console.log("PROBLEMS:", problems);
entries.slice(0,4).forEach(e=>console.log(`  ${e.bracket} (${e.name}): champ=${e.champion}, SF=${e.sf.join("/")}, GB=${e.goldenBall}→${e.goldenBallKey}, TB=${e.tiebreak}`));
