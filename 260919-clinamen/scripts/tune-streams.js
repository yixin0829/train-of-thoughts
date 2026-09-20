// bun scripts/tune-streams.js — accelerated trials of the real 120 Hz simulation.
import { Sim, POOL_R } from '../lib/sim';
import { contactRadii } from '../lib/bowl-shape';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';

const pulsed = process.argv.includes('--pulsed');
const out = resolve(pulsed ? 'reports/stream-tuning-pulsed' : 'reports/stream-tuning');
const rng = (seed) => () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const quantile = (a, p) => a.toSorted((x, y) => x - y)[Math.floor((a.length - 1) * p)];
const probes = Array.from({length: 256}, (_, i) => {
  const r = POOL_R * Math.sqrt((i + 0.5) / 256), a = i * 2.399963229728653;
  return [r * Math.cos(a), r * Math.sin(a)];
});
function metrics(bowls) {
  const gaps = bowls.map((b, i) => Math.max(0, Math.min(...bowls.filter((_, j) => j !== i).map(o => {
    const [ra, rb] = contactRadii(b.d, o.d);
    return Math.hypot(b.x - o.x, b.y - o.y) - ra - rb;
  }))));
  const gap = mean(gaps), q25 = quantile(gaps, 0.25);
  const coverage90 = quantile(probes.map(([x, y]) => Math.min(...bowls.map(b => Math.max(0, Math.hypot(b.x - x, b.y - y) - b.r)))), 0.9);
  const edge = mean(bowls.map(b => +(POOL_R - b.r - Math.hypot(b.x, b.y) < 5)));
  const clustered = mean(gaps.map(g => +(g < 3)));
  const speed = mean(bowls.map(b => Math.hypot(b.vx, b.vy)));
  return {score: 0.65 * gap + 0.35 * q25 - 0.2 * coverage90 - 6 * edge - 4 * clustered, gap, q25, coverage90, edge, clustered, speed};
}
function trial({id, config, seed, count = 24, current = 0.5}) {
  const saved = Math.random;
  Math.random = rng(seed);
  let sim;
  try { sim = new Sim(count, config); } finally { Math.random = saved; }
  if (sim.bowls.length !== count) throw Error('Placement failed');
  sim.current = current;
  let strikes = 0;
  const late = [];
  for (let i = 1; i <= 36000; i++) {
    strikes += sim.step(1 / 120).length;
    if (i >= 32400 && i % 600 === 0) late.push(metrics(sim.bowls));
  }
  if (!sim.bowls.every(b => Number.isFinite(b.x + b.y + b.vx + b.vy))) throw Error('Nonfinite state');
  const end = late.at(-1);
  const lateScore = mean(late.map(m => m.score));
  return {id, config, seed, count, current, ...end, lateScore, rankScore: 0.7 * end.score + 0.3 * lateScore, strikes, bowls: sim.bowls.map(({x,y,r,d}) => ({x,y,r,d}))};
}

if (process.argv[2] === '--worker') {
  const jobs = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const results = jobs.map(trial);
  writeFileSync(process.argv[4], JSON.stringify(results));
} else {
  mkdirSync(out, {recursive: true});
  const started = performance.now();
  const summarize = rows => Object.values(Object.groupBy(rows, r => r.id)).map(group => {
    const result = {id:group[0].id, config:group[0].config, n:group.length};
    for (const k of ['rankScore','score','gap','q25','coverage90','edge','clustered','speed','lateScore','strikes']) result[k] = mean(group.map(r => r[k]));
    return result;
  }).sort((a,b) => b.rankScore - a.rankScore);
  async function batch(name, jobs) {
    console.log(`${name}: ${jobs.length} five-minute trials`);
    const workers = Math.min(4, cpus().length);
    const chunks = Array.from({length:workers}, (_, i) => jobs.filter((_, j) => j % workers === i));
    await Promise.all(chunks.map((chunk, i) => new Promise((ok, fail) => {
      const input = resolve(out, `${name}-${i}-jobs.json`), output = resolve(out, `${name}-${i}.json`);
      writeFileSync(input, JSON.stringify(chunk));
      const child = spawn(process.execPath, [process.argv[1], '--worker', input, output], {stdio:'inherit', windowsHide:true});
      child.on('error', fail);
      child.on('exit', code => code === 0 ? ok() : fail(Error(`Worker exited ${code}`)));
    })));
    const rows = chunks.flatMap((_,i) => JSON.parse(readFileSync(resolve(out, `${name}-${i}.json`),'utf8')));
    console.log(name, summarize(rows).slice(0, 8).map(r => ({id:r.id, score:+r.rankScore.toFixed(2), gap:+r.gap.toFixed(2), clustered:+r.clustered.toFixed(2),config:r.config})));
    return rows;
  }
  const random = rng(823171);
  // Freeze the starting configuration so reruns remain comparable after tuning.
  const baseline = {id:'baseline', config:{speed:26, width:32, spread:0.6, reach:150}};
  const off = {id:'no-streams', config:{...baseline.config, speed:0}};
  const candidates = [baseline, off];
  if (pulsed) candidates.push({id:'short-steady',config:{speed:27,width:22,spread:0.27,reach:79}});
  for (let i = 0; i < (pulsed ? 40 : 72); i++) candidates.push({id:`${pulsed ? 'pulse' : 'candidate'}-${i+1}`, config:{
    speed: Math.round((pulsed ? 20 : 4) + random() * (pulsed ? 70 : 56)), width: Math.round(12 + random() * 53),
    spread: +(0.1 + random() * 0.9).toFixed(2), reach: Math.round(60 + random() * 90),
    ...(pulsed ? {pulsePeriod:Math.round(15 + random()*75),pulseDuty:+(0.2+random()*.5).toFixed(2)} : {}),
  }});
  const screening = await batch('screening', candidates.flatMap(c => [101,202,303].map(seed => ({...c,seed}))));
  const leaders = summarize(screening).filter(c => c.id !== 'baseline' && c.id !== 'no-streams').slice(0,6);
  const finalists = [baseline, off, ...leaders.map(({id,config})=>({id,config}))];
  const validation = await batch('validation', finalists.flatMap(c => Array.from({length:20},(_,i)=>({...c,seed:(pulsed ? 3001 : 1001)+i}))));
  const ranked = summarize(validation);
  const winner = ranked[0];
  const bestActive = ranked.find(r => r.config.speed > 0);
  const robustness = await batch('robustness', [baseline, {id:bestActive.id,config:bestActive.config}, off].flatMap(c => [
    {count:12,current:0.5}, {count:48,current:0.5}, {count:24,current:0.25}, {count:24,current:1},
  ].flatMap(s => Array.from({length:5},(_,i)=>({...c,...s,seed:2001+i})))));
  const baseRows = validation.filter(r=>r.id==='baseline');
  const winnerRows = validation.filter(r=>r.id===winner.id);
  const diffs = winnerRows.map(r=>r.rankScore-baseRows.find(b=>b.seed===r.seed).rankScore);
  const bootRng = rng(7562);
  const boot = Array.from({length:5000},()=>mean(Array.from({length:diffs.length},()=>diffs[Math.floor(bootRng()*diffs.length)])));
  const result = {seconds: (performance.now()-started)/1000, physicsHz:120, secondsPerTrial:300,
    definition:'Rank = 70% score at 300s + 30% mean score sampled every 5s from 270–300s. Score = .65 mean nearest contact gap + .35 lower-quartile gap - .2 90th-percentile empty-space distance - 6 rim fraction - 4 near-contact fraction. Distances cm. Rim = <5cm wall clearance; near contact = gap <3cm.',
    ranked, winner, bestActive, paired:{mean:mean(diffs), wins:diffs.filter(x=>x>0).length,n:diffs.length,bootstrap95:[quantile(boot,.025),quantile(boot,.975)]}, screening, validation, robustness};
  writeFileSync(resolve(out,'results.json'),JSON.stringify(result,null,2));
  // Retain the consolidated measurements, not duplicate worker scratch files.
  for (const stage of ['screening','validation','robustness']) for (let i=0;i<Math.min(4,cpus().length);i++) {
    unlinkSync(resolve(out,`${stage}-${i}-jobs.json`));
    unlinkSync(resolve(out,`${stage}-${i}.json`));
  }
  console.log('FINAL',JSON.stringify({seconds:result.seconds,winner,paired:result.paired}));
}
