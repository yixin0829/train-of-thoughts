# Five-minute stream configuration study

Ran **771 five-minute trials** of the real 120 Hz physics: **64.25 simulated hours in 3.87 minutes** of headless execution (up to four worker processes). The search covered 72 steady and 40 pulsed candidates, plus controls. All three inlet positions remain an equilateral triangle at the rim.

Selected and applied **pulse-35**: peak speed 30 cm/s at full current, Gaussian width parameter 33 cm, widening 0.22 cm per downstream cm, reach 107 cm, quadratic falloff, 70-second period, duty fraction 0.47, and one-third-cycle phase offsets between inlets. Pulses rise and fall smoothly. At the normal 50% current setting, peak inlet speed is 15 cm/s.

The initial constant inward streams cleared the rim but produced central crowding. Shortening them helped; staggered pulses performed better on the stated spacing objective.

## Results at five minutes

Twenty new matched layouts, 24 bowls, 50% current:

| Metric | Original streams | Selected pulses | No streams |
|---|---:|---:|---:|
| Average nearest-bowl surface gap | 2.21 cm | **6.97 cm** | 5.71 cm |
| Bowls within 3 cm of another | 79.2% | **62.3%** | 62.1% |
| Empty-space distance, 90th percentile | 66.19 cm | **43.73 cm** | 46.98 cm |
| Bowls within 5 cm of rim | 0% | **6.7%** | 11.7% |

The selected configuration improved the combined spacing score versus the original on **20/20** layouts. It also improved the score in separate checks at 12/48 bowls and 25%/100% current. This is the best configuration tested under the documented objective, not proof of a global optimum.

**Tradeoff:** pulses allow occasional rim visits. All 108 single-bowl edge-release cases (36 angles × 3 sizes) cleared 12 cm inward within 66.2 seconds, versus 30.3 seconds for the original steady streams. Endpoint rim occupancy is not the same as being stuck there. Near-contact clustering remains substantial: 62%, so this does not eliminate all groups.

The score rewards mean and lower-quartile contact gaps, penalizes large empty areas and rim/near-contact fractions, and weights the exact 300-second endpoint 70% with the final 30-second average 30%. Current, bowl count and initial seed are matched between configurations. No timestep enlargement was used.

- [Steady-stream study](stream-tuning/report.md)
- [Pulsed-stream study and full settings](stream-tuning-pulsed/report.md)
- [Example layout at 300 seconds](stream-tuning-pulsed/comparison.svg)

Reproduce with `bun scripts/tune-streams.js`, `bun scripts/tune-streams.js --pulsed`, then the corresponding `bun scripts/summarize-streams.js` commands. Run the edge-release check with `bun scripts/check-streams.ts`.
