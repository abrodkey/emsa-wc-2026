#!/usr/bin/env node
/**
 * EMSA World Cup 2026 — Golden Boot race updater.
 *
 * Tallies every goal of the tournament (group stage + knockouts) from ESPN's
 * free fifa.world feed and writes scorers.json: a ranked list of top scorers
 * with goals, penalties, and assists. Own goals are excluded (they don't count
 * toward the Golden Boot). Run every 10 min by the GitHub Action. No API key.
 */

import { writeFileSync } from "node:fs";

/* ESPN team name -> pool name (for flags on the board) */
const ALIAS = {
  "South Korea":"Korea Republic","Korea, Republic of":"Korea Republic",
  "United States":"USA","United States of America":"USA",
  "Turkey":"Türkiye","Turkiye":"Türkiye","Czech Republic":"Czechia",
  "Côte d'Ivoire":"Ivory Coast","Cote d'Ivoire":"Ivory Coast",
  "Cabo Verde":"Cape Verde","Congo DR":"DR Congo","Democratic Republic of the Congo":"DR Congo",
  "Bosnia and Herzegovina":"Bosnia-Herzegovina","Curacao":"Curaçao","IR Iran":"Iran"
};
const POOL=["Mexico","South Africa","Korea Republic","Czechia","Canada","Bosnia-Herzegovina","Qatar","Switzerland","Brazil","Morocco","Haiti","Scotland","USA","Paraguay","Australia","Türkiye","Germany","Curaçao","Ivory Coast","Ecuador","Netherlands","Japan","Sweden","Tunisia","Belgium","Egypt","Iran","New Zealand","Spain","Cape Verde","Saudi Arabia","Uruguay","France","Senegal","Iraq","Norway","Argentina","Algeria","Austria","Jordan","Portugal","DR Congo","Uzbekistan","Colombia","England","Croatia","Ghana","Panama"];
const POOLSET=new Set(POOL);
const norm=s=>(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/g,"");
const NORM=new Map(POOL.map(t=>[norm(t),t]));
function mapTeam(cands){ for(const c of cands){if(!c)continue;if(POOLSET.has(c))return c;if(ALIAS[c])return ALIAS[c];} for(const c of cands){if(!c)continue;const h=NORM.get(norm(c));if(h)return h;} return cands.find(Boolean)||""; }

function ymd(d){ return d.toISOString().slice(0,10).replace(/-/g,""); }

async function main(){
  const start=new Date(Date.UTC(2026,5,11));   // Jun 11
  const end  =new Date(Date.UTC(2026,6,20));   // through Jul 19 (final is Jul 19, 2026)
  const idToTeam={}; const tally=new Map(); let goals=0, played=0;

  function rec(id, name, team, isPen, isAssist){
    if(!name) return;
    const key=id||(name+"|"+team);
    let e=tally.get(key);
    if(!e){ e={name, team, goals:0, pens:0, assists:0}; tally.set(key,e); }
    if(isAssist) e.assists++;
    else { e.goals++; if(isPen) e.pens++; }
  }

  for(let d=new Date(start); d<end; d.setUTCDate(d.getUTCDate()+1)){
    let j;
    try{ j=await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${ymd(d)}`,{headers:{"cache-control":"no-cache"}})).json(); }
    catch(e){ console.error("fetch fail",ymd(d),e.message); continue; }
    for(const ev of (j.events||[])){
      const comp=ev.competitions?.[0]; if(!comp) continue;
      const state=ev.status?.type?.state;
      if(state!=="post"&&state!=="in") continue;
      if(state==="post") played++;
      for(const c of (comp.competitors||[])){
        if(c.team?.id) idToTeam[c.team.id]=mapTeam([c.team.displayName,c.team.shortDisplayName,c.team.name,c.team.location]);
      }
      for(const det of (comp.details||[])){
        if(!det.scoringPlay || det.ownGoal) continue;      // only real goals, no own goals
        const team=idToTeam[det.team?.id]||"";
        const ath=det.athletesInvolved||[];
        const scorer=ath[0], assist=ath[1];
        if(scorer){ rec(scorer.athlete?.id||scorer.id, scorer.displayName, team, !!det.penaltyKick, false); goals++; }
        if(assist){ rec(assist.athlete?.id||assist.id, assist.displayName, team, false, true); }
      }
    }
  }

  const scorers=[...tally.values()].filter(e=>e.goals>0)
    .sort((a,b)=> b.goals-a.goals || (b.goals-b.pens)-(a.goals-a.pens) || b.assists-a.assists || a.name.localeCompare(b.name));
  let rank=0,prev=null,seen=0;
  scorers.forEach(e=>{ seen++; if(prev===null||e.goals!==prev){rank=seen;prev=e.goals;} e.rank=rank; });

  const out={ updated:new Date().toISOString(), season:"2026 FIFA World Cup", source:"ESPN fifa.world feed",
    matchesPlayed:played, totalGoals:goals, scorers };
  writeFileSync("scorers.json", JSON.stringify(out,null,2));
  console.log(`Wrote scorers.json — ${goals} goals over ${played} matches, ${scorers.length} scorers.`);
  scorers.slice(0,10).forEach(e=>console.log(`  ${e.rank}. ${e.name} (${e.team}) — ${e.goals}g${e.pens?` ${e.pens}p`:""}${e.assists?` ${e.assists}a`:""}`));
}
main().catch(e=>{console.error(e);process.exit(1);});
