#!/usr/bin/env node
/**
 * EMSA World Cup 2026 — live score updater.
 *
 * Pulls group-stage match results from ESPN's free fifa.world feed, computes
 * each group's table (FIFA tiebreakers, best-effort), determines the 8 best
 * third-place qualifiers once every group is final, merges any manual
 * corrections from overrides.json, and writes results.json.
 *
 * Run every 10 min by .github/workflows/update-scores.yml. No API key required.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

/* ----- The pool's authoritative group composition (source of truth for groups) ----- */
const GROUPS = {
  A:["Mexico","South Africa","Korea Republic","Czechia"],
  B:["Canada","Bosnia-Herzegovina","Qatar","Switzerland"],
  C:["Brazil","Morocco","Haiti","Scotland"],
  D:["USA","Paraguay","Australia","Türkiye"],
  E:["Germany","Curaçao","Ivory Coast","Ecuador"],
  F:["Netherlands","Japan","Sweden","Tunisia"],
  G:["Belgium","Egypt","Iran","New Zealand"],
  H:["Spain","Cape Verde","Saudi Arabia","Uruguay"],
  I:["France","Senegal","Iraq","Norway"],
  J:["Argentina","Algeria","Austria","Jordan"],
  K:["Portugal","DR Congo","Uzbekistan","Colombia"],
  L:["England","Croatia","Ghana","Panama"]
};
const GL = Object.keys(GROUPS);
const POOL = GL.flatMap(g => GROUPS[g]);
const POOLSET = new Set(POOL);
const groupOf = {}; GL.forEach(g => GROUPS[g].forEach(t => groupOf[t] = g));

/* ----- ESPN name -> pool name aliases (only the ones that don't match directly) ----- */
const ALIAS = {
  "South Korea":"Korea Republic", "Korea Republic":"Korea Republic", "Korea, Republic of":"Korea Republic",
  "United States":"USA", "United States of America":"USA", "USMNT":"USA",
  "Turkey":"Türkiye", "Turkiye":"Türkiye",
  "Czech Republic":"Czechia",
  "Côte d'Ivoire":"Ivory Coast", "Cote d'Ivoire":"Ivory Coast", "Ivory Coast":"Ivory Coast",
  "Cabo Verde":"Cape Verde",
  "Congo DR":"DR Congo", "DR Congo":"DR Congo", "Democratic Republic of the Congo":"DR Congo", "Congo (DR)":"DR Congo",
  "Bosnia and Herzegovina":"Bosnia-Herzegovina", "Bosnia & Herzegovina":"Bosnia-Herzegovina",
  "Curacao":"Curaçao",
  "IR Iran":"Iran", "Iran":"Iran",
  "Republic of Ireland":"Ireland"
};
function normTeam(s){ return (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/g,""); }
const NORM_POOL = new Map(POOL.map(t => [normTeam(t), t]));
function mapTeam(cands){
  for (const c of cands){ if (!c) continue; if (POOLSET.has(c)) return c; if (ALIAS[c]) return ALIAS[c]; }
  for (const c of cands){ if (!c) continue; const hit = NORM_POOL.get(normTeam(c)); if (hit) return hit; }
  return null;
}

/* ----- Fetch group-stage match results from ESPN ----- */
function ymd(d){ return d.toISOString().slice(0,10).replace(/-/g,""); }
async function fetchMatches(){
  const start = new Date(Date.UTC(2026,5,11));   // Jun 11
  const end   = new Date(Date.UTC(2026,5,28));   // through Jun 27 inclusive
  const out = [], unmatched = new Set();
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate()+1)){
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${ymd(d)}`;
    let j;
    try { const r = await fetch(url, { headers:{ "cache-control":"no-cache" } }); j = await r.json(); }
    catch (e){ console.error("fetch failed", ymd(d), e.message); continue; }
    for (const ev of (j.events||[])){
      const comp = ev.competitions?.[0]; if (!comp) continue;
      const state = ev.status?.type?.state;            // pre | in | post
      if (state !== "post" && state !== "in") continue; // only count played / live
      const cs = comp.competitors||[];
      const home = cs.find(c=>c.homeAway==="home")||cs[0];
      const away = cs.find(c=>c.homeAway==="away")||cs[1];
      if (!home||!away) continue;
      const ht = mapTeam([home.team?.displayName, home.team?.shortDisplayName, home.team?.name, home.team?.location]);
      const at = mapTeam([away.team?.displayName, away.team?.shortDisplayName, away.team?.name, away.team?.location]);
      if (!ht) unmatched.add(home.team?.displayName);
      if (!at) unmatched.add(away.team?.displayName);
      if (!ht || !at) continue;
      if (groupOf[ht] !== groupOf[at]) continue;        // only intra-group (i.e. group-stage) games
      out.push({
        group: groupOf[ht], home: ht, away: at,
        hs: parseInt(home.score,10)||0, as: parseInt(away.score,10)||0,
        state, detail: ev.status?.type?.shortDetail || ev.status?.type?.detail || "",
        date: ev.date
      });
    }
  }
  if (unmatched.size) console.error("UNMATCHED ESPN teams:", [...unmatched]);
  return out;
}

/* ----- Compute a group table with best-effort FIFA tiebreakers ----- */
function tableFor(teams, matches){
  const st = {}; teams.forEach(t => st[t] = { t, P:0,W:0,D:0,L:0,GF:0,GA:0,Pts:0 });
  for (const m of matches){
    const h = st[m.home], a = st[m.away]; if (!h||!a) continue;
    h.P++; a.P++; h.GF+=m.hs; h.GA+=m.as; a.GF+=m.as; a.GA+=m.hs;
    if (m.hs>m.as){ h.W++; a.L++; h.Pts+=3; }
    else if (m.hs<m.as){ a.W++; h.L++; a.Pts+=3; }
    else { h.D++; a.D++; h.Pts++; a.Pts++; }
  }
  Object.values(st).forEach(e => e.GD = e.GF - e.GA);
  function h2h(x,y){
    let xp=0,yp=0,xg=0,yg=0;
    for (const m of matches){
      if (m.home===x.t && m.away===y.t){ xg+=m.hs-m.as; yg+=m.as-m.hs; if(m.hs>m.as)xp+=3; else if(m.hs<m.as)yp+=3; else {xp++;yp++;} }
      if (m.home===y.t && m.away===x.t){ yg+=m.hs-m.as; xg+=m.as-m.hs; if(m.hs>m.as)yp+=3; else if(m.hs<m.as)xp+=3; else {xp++;yp++;} }
    }
    return (yp-xp) || (yg-xg) || 0;
  }
  return Object.values(st).sort((x,y) =>
    y.Pts-x.Pts || y.GD-x.GD || y.GF-x.GF || h2h(x,y) || x.t.localeCompare(y.t)
  );
}

/* ----- Build results.json ----- */
function loadOverrides(){
  try { if (existsSync("overrides.json")) return JSON.parse(readFileSync("overrides.json","utf8")); }
  catch (e){ console.error("overrides.json parse error", e.message); }
  return {};
}

async function main(){
  const matches = await fetchMatches();
  const ov = loadOverrides();

  const standings = {}, complete = {}, scoring = {}, tableMeta = {};
  for (const g of GL){
    const gm = matches.filter(m => m.group === g);
    if (!gm.length) continue;                      // no games yet -> nothing to show
    const tbl = tableFor(GROUPS[g], gm);
    // always expose the live table (even mid-round) for the Scores & Tables view
    tableMeta[g] = tbl.map(e => ({ team:e.t, P:e.P, W:e.W, D:e.D, L:e.L, GF:e.GF, GA:e.GA, GD:e.GD, Pts:e.Pts }));
    complete[g] = gm.filter(m => m.state === "post").length >= 6;
    // only score a group once EVERY team has completed its first match (a fair full round)
    const playedPost = {}; GROUPS[g].forEach(t => playedPost[t] = 0);
    gm.forEach(m => { if (m.state === "post"){ playedPost[m.home]++; playedPost[m.away]++; } });
    const allPlayed = GROUPS[g].every(t => playedPost[t] >= 1);
    if (allPlayed){
      scoring[g] = true;
      standings[g] = {}; tbl.forEach((e,i) => standings[g][e.t] = i+1);
    }
  }

  // manual standings corrections (per fully-specified group) win
  if (ov.standings) for (const g of GL){
    if (ov.standings[g] && Object.keys(ov.standings[g]).length){ standings[g] = { ...ov.standings[g] }; tableMeta[g] = tableMeta[g]||null; }
  }

  // 8 best third-placed teams — only meaningful once every group is final
  let thirds = ov.thirds && ov.thirds.length ? ov.thirds.slice() : [];
  const allDone = GL.every(g => complete[g]);
  if (allDone && !thirds.length){
    const thirdTeams = GL.map(g => (tableMeta[g]||[])[2]).filter(Boolean);
    thirdTeams.sort((x,y) => y.Pts-x.Pts || y.GD-x.GD || y.GF-x.GF || x.team.localeCompare(y.team));
    thirds = thirdTeams.slice(0,8).map(e => e.team);
  }

  const out = {
    updated: new Date().toISOString(),
    season: "2026 FIFA World Cup",
    source: "ESPN fifa.world feed",
    phase: allDone ? "groups-complete" : "group-stage",
    standings, complete, scoring, tableMeta, thirds,
    champion: ov.champion || "",
    boot: ov.boot || "",
    eliminated: ov.eliminated || [],
    matches: matches.map(m => ({ group:m.group, home:m.home, away:m.away, hs:m.hs, as:m.as, state:m.state, detail:m.detail, date:m.date }))
  };

  writeFileSync("results.json", JSON.stringify(out, null, 2));
  const playedGroups = Object.keys(standings).length;
  console.log(`Wrote results.json — ${matches.length} matches, ${playedGroups}/12 groups with data, thirds:${thirds.length}`);
  for (const g of Object.keys(standings)){
    const order = Object.entries(standings[g]).sort((a,b)=>a[1]-b[1]).map(([t,p])=>`${p}.${t}`).join("  ");
    console.log(`  Group ${g}${complete[g]?" (final)":""}: ${order}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
