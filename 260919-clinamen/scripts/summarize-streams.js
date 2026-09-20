// bun scripts/summarize-streams.js
import {readFileSync, writeFileSync} from 'node:fs';
const root = process.argv.includes('--pulsed') ? 'reports/stream-tuning-pulsed' : 'reports/stream-tuning';
const data = JSON.parse(readFileSync(`${root}/results.json`, 'utf8'));
const bestActive = data.bestActive ?? data.ranked.find(r=>r.config.speed>0);
const total = data.screening.length + data.validation.length + data.robustness.length;
const seed = Math.min(...data.validation.map(r=>r.seed));
const mean = a => a.reduce((s,v)=>s+v,0)/a.length;
const fmt = x => x.toFixed(2);
const pct = x => `${(100*x).toFixed(1)}%`;
const row = r => `| ${r.id} | ${fmt(r.rankScore)} | ${fmt(r.gap)} | ${pct(r.clustered)} | ${pct(r.edge)} | ${fmt(r.coverage90)} | ${fmt(r.speed)} |`;
const conditions = [...new Set(data.robustness.map(r=>`${r.count}/${r.current}`))];
const robustness = conditions.map(condition => {
  const [count,current] = condition.split('/').map(Number);
  const values = data.robustness.filter(r=>r.count===count && r.current===current);
  const a = values.filter(r=>r.id==='baseline'), b = values.filter(r=>r.id===(data.bestActive?.id ?? data.winner.id));
  return `| ${count} | ${pct(current)} | ${fmt(mean(a.map(r=>r.gap)))} → ${fmt(mean(b.map(r=>r.gap)))} | ${pct(mean(a.map(r=>r.clustered)))} → ${pct(mean(b.map(r=>r.clustered)))} | ${fmt(mean(b.map(r=>r.rankScore))-mean(a.map(r=>r.rankScore)))} |`;
});
const report = `# Invisible stream tuning

Five-minute headless trials of the production Sim, at exactly 120 physics steps per simulated second (36,000 steps/trial). No enlarged timestep or substituted physics. Three inlet positions stay on the rim, 120° apart, pointing inward. The existing wall-flow turn remains active even in the no-stream control.

## Method

- ${data.screening.length/3} configurations; 3 matched layouts each (${data.screening.length} trials).
- Six leading candidates plus both controls: 20 new matched layouts each (${data.validation.length} trials).
- Selected configuration(s) and controls: 12/48 bowls at 50% current and 24 bowls at 25%/100% current, 5 new layouts per condition (${data.robustness.length} trials).
- Primary condition: 24 bowls, 50% current. Steady search: speed 4–60 cm/s, width 12–65 cm, spread .1–1, reach 60–150 cm. Pulsed search: peak speed 20–90 cm/s, same width/spread/reach ranges, period 15–90s, duty .2–.7, phases 120 degrees apart. Speeds are at full current. Quadratic downstream decay; Gaussian cross-stream profile. Source and per-trial results record exact configurations.
- ${data.definition}
- ${total} total trials, ${fmt(total/12)} simulated hours; wall-clock ${fmt(data.seconds/60)} minutes using up to four worker processes.

## Held-out validation

Higher composite score and gap are better; lower clustering, rim fraction and empty-space distance are better. Negative scores are valid and have no absolute physical meaning.

| Configuration | Score | Mean nearest gap (cm) | Near-contact bowls | Rim bowls | Empty-space p90 (cm) | Mean speed (cm/s) |
|---|---:|---:|---:|---:|---:|---:|
${data.ranked.map(row).join('\n')}

Winner: **${data.winner.id}**, ${JSON.stringify(data.winner.config)}.
Best nonzero streams: **${bestActive.id}**, ${JSON.stringify(bestActive.config)}.
Paired score improvement over original: ${fmt(data.paired.mean)}; exploratory bootstrap 95% interval [${data.paired.bootstrap95.map(fmt).join(', ')}], ${data.paired.wins}/${data.paired.n} layouts improved. The winner was selected using this validation set; the interval is descriptive, not an independent post-selection guarantee.

## Other settings (original → best active streams, or selected control in the initial run)

| Bowls | Current | Mean gap (cm) | Near-contact bowls | Score improvement |
|---|---:|---:|---:|---:|
${robustness.join('\n')}

## Limits

Best among tested configurations under the stated objective, not a global optimum. Five-minute sparseness does not measure subjective motion quality, sound quality, dragging, or longer-term behaviour. The final 30 seconds are sampled to reduce sensitivity to a lucky single frame. Gaps use the same size-dependent contact radii as the simulation.

![Same layout at 300 seconds](comparison.svg)

The illustration uses seed ${seed} (fixed first validation seed), not a hand-picked best result. All trial snapshots and scores are in results.json. Reproduce with \`bun scripts/tune-streams.js\`, then \`bun scripts/summarize-streams.js\`; add \`--pulsed\` to both commands for the pulse search.
`;
writeFileSync(`${root}/report.md`,report);
const snapshots = ['baseline',data.winner.id].map(id=>data.validation.find(r=>r.id===id&&r.seed===seed));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="440" viewBox="0 0 760 440"><rect width="760" height="440" fill="#20282e"/><text x="380" y="30" text-anchor="middle" fill="#eee9df" font-family="sans-serif" font-size="18">Same starting bowls • 300 seconds • 24 bowls / 50% current</text>${snapshots.map((r,i)=>{
  const cx = 190+i*380, cy=230;
  return `<text x="${cx}" y="64" text-anchor="middle" fill="#eee9df" font-family="sans-serif" font-size="16">${i===0?'Original streams':'Selected streams'}</text><circle cx="${cx}" cy="${cy}" r="150" fill="#2986a6" stroke="#ddd4c3" stroke-width="3"/>${r.bowls.map(b=>`<circle cx="${cx+b.x}" cy="${cy+b.y}" r="${b.r}" fill="#eee6d9" stroke="#9b9385"/>`).join('')}<text x="${cx}" y="412" text-anchor="middle" fill="#eee9df" font-family="sans-serif" font-size="14">Mean gap ${fmt(r.gap)} cm • near-contact ${pct(r.clustered)}</text>`;
}).join('')}</svg>`;
writeFileSync(`${root}/comparison.svg`,svg);
console.log(report);
