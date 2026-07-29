# Simulation performance contract

The Phase 10 headless benchmark measures the fixed-step simulation without
loading React or Phaser. It creates deterministic, balanced idle armies at 100,
300, 600, and 1,000 units, warms the simulation, and records 50 measured ticks.

Run the benchmark with Node.js 24.18.0:

```powershell
npm run benchmark:simulation
```

To replace the checked-in machine baseline intentionally:

```powershell
npm run benchmark:baseline
```

The JSON report records the Git revision and dirty state, hardware and runtime
profile, seed, object and snapshot sizes, heap deltas, snapshot hashes, and
p50/p95/p99/worst timings for the complete tick and each observed simulation
system. Heap deltas are process-level signals rather than exact allocation
counts and should be compared across repeated runs on the same machine.

The checked-in [baseline](./baseline.json) is evidence from its recorded
hardware profile, not a universal CI threshold. The release gate remains the
roadmap's minimum-hardware profile once that profile is defined.

## Replay contract

Run the deterministic replay gate with:

```powershell
npm run replay:verify
```

The versioned fixtures cover combat, economy, skirmish AI, fog movement, and a
Solar Spear impact. Commands are queued at their recorded simulation ticks, and
SHA-256 hashes are checked at intermediate checkpoints and at the final tick.
When an explicitly reviewed simulation change requires a replay migration,
regenerate hashes with:

```powershell
node scripts/verify-simulation-replays.mjs --update
```

Review every changed hash before accepting the migration.
