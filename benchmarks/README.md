# Simulation performance contract

The headless benchmark measures the fixed-step simulation without loading React
or Phaser. The general benchmark covers deterministic balanced idle armies at
100, 300, 600, and 1,000 units. A separate Phase 11 benchmark covers a 200-unit
shared formation move and a 200-unit direct attack/chase fan-out. Keeping the
workloads in separate processes prevents earlier high-count cases from
contaminating the targeted worst-tick gate through heap and thermal state. Each
workload warms the simulation and records 50 measured ticks.

Run the benchmark with Node.js 24.18.0:

```powershell
npm run benchmark:simulation
```

To run only the targeted pathfinding workloads with the 25 ms worst-tick gate:

```powershell
npm run benchmark:pathfinding
```

To run the Phase 12 worker acceptance gate with a 600-unit Normal workload:

```powershell
npm run benchmark:worker
```

The worker benchmark owns its simulation and 20 Hz clock on a Node worker
thread. It runs 100 measured ticks, publishes a full snapshot every two ticks,
and includes structured-clone submission in the measured work. Its
machine-readable gate fails if the workload is not exactly 600 units, does not
complete every tick, takes more than the 50 ms tick interval, or misses the
following fixed-step deadline. Scheduling lateness is reported separately so
machine contention remains visible even when the simulation retains sufficient
deadline headroom.

To replace the checked-in machine baseline intentionally:

```powershell
npm run benchmark:baseline
```

The JSON report records the Git revision and dirty state, hardware and runtime
profile, seed, object and snapshot sizes, heap deltas, snapshot hashes, and
p50/p95/p99/worst timings for the complete tick and each observed simulation
system. Targeted results also record the maximum expansion count, initial
command-phase request fan-out, and pending-request count. Their gate fails when
pathfinding exceeds its expansion budget, a formation creates more than one
initial request, a direct attack creates anything other than one request per
attacker, the worst measured tick exceeds 25 ms, or requests remain after the
untimed deterministic completion window. The completion window holds direct
attackers after measurement to prevent fresh chase replans, then allows the
worst-case 16,384 expansions per queued unit at the 1,024 initial congested
budget. The normal per-tick pathfinding cap remains 4,096 expansions. A queue
with at least 128 requests, or a formation containing at least 128 units, uses
a deterministic congested cap until that workload drains. Queued individual
paths receive 2,048 expansions per tick. A newly congested workload's first
tick and a large shared formation's anchor receive 1,024 expansions; subsequent
individual paths receive the 2,048 cap. Heap deltas are process-level signals
rather than exact allocation counts and should be compared across repeated runs
on the same machine.

The checked-in [baseline](./baseline.json) records the pre-index implementation.
The [spatial-index result](./spatial-index.json) records the same benchmark
after constant-time entity lookup and nearby-cell separation were introduced.
Both are evidence from their recorded hardware profile, not universal CI
thresholds. The release gate remains the roadmap's minimum-hardware profile
once that profile is defined.

| Units | Tick p95 before | Tick p95 after | Change | Separation p95 before | Separation p95 after | Change |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 0.1889 ms | 0.2031 ms | +7.5% | 0.0581 ms | 0.1651 ms | +184.2% |
| 300 | 0.5246 ms | 0.4991 ms | -4.9% | 0.3292 ms | 0.4181 ms | +27.0% |
| 600 | 1.4333 ms | 0.8506 ms | -40.7% | 1.2267 ms | 0.7405 ms | -39.6% |
| 1,000 | 3.7106 ms | 1.7310 ms | -53.3% | 3.3035 ms | 1.5085 ms | -54.3% |

The grid has fixed bookkeeping overhead at small army sizes, visible most
clearly in the 100-unit separation measurement. It crosses over before 600
units and removes the previous quadratic growth curve.

## Replay contract

Run the deterministic replay gate with:

```powershell
npm run replay:verify
```

The versioned fixtures cover combat, economy, skirmish AI, fog movement, and a
Solar Spear impact. Commands, checkpoints, and the replay end use explicit
`{ epoch, tick }` coordinates. A queued restart advances the epoch, allowing
ticks to repeat without dispatching commands early or overwriting checkpoint
hashes from an earlier timeline. SHA-256 hashes of canonically serialized
authoritative state are checked at every requested checkpoint and at the replay
end. The state includes hidden entities, RNG, command queues, AI memory,
visibility, deterministic ID counters, control groups, and other fields that can
affect future simulation behavior. The verifier rejects malformed epoch
transitions, unreachable or duplicate checkpoints, and incomplete checkpoint
capture before `--update` can rewrite expected hashes.
When an explicitly reviewed simulation change requires a replay migration,
regenerate hashes with:

```powershell
node scripts/verify-simulation-replays.mjs --update
```

Review every changed hash before accepting the migration.
