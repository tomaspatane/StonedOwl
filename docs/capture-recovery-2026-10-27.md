# Capture recovery — 2026-10-27

The hourly workflow checks out two feature branches. Repair code must reach both; main contains the scheduler, not either capture implementation.

- ENRE accepts H:mm and HH:mm only when the source Last-Modified supplies a compatible date. The ten-minute anchor bound, thirty-minute source freshness bound, CABA locality checks and comparison coverage checks remain enforced.
- Reddit requests are sequential, with at most one retry. Retry-After above ten seconds defers the batch instead of blocking the runner. 403 and persistent 429 stop the batch with explicit unavailable coverage. The electricity report carries retryAt; the next capture reads that cooldown from its restored predecessor. Missing predecessor means no persisted cooldown is available.
- Serper requires allowPaidFallback=true in addition to a key. Scheduled scripts default to free sources. New RSS queries use existing publisher-owned endpoints; multiple queries are not independent publishers or exhaustive barrio coverage.
- quality separates execution, source freshness, evidence, publication, comparison and observed schedule interval. Empty captures remain insufficient and automatic publication remains blocked. The legacy ok field retains strict source-health semantics; it is not publication approval.
- provenance records the checked-out source commit, workflow commit, run attempt, source configuration and configuration hash. Topic provenance is also stored in the snapshot envelope.
- Invalid official snapshots retain raw records for audit but suppress affectedUsers in the convenience radar. The comparison records common, appearing and disappearing groups, without converting missing groups to zero.

## Verification

Run npm test on both branches. capture-recovery.mjs covers observed one-digit clocks, source-date failures, provider retries/cooldowns, no implicit paid fallback, strict Reddit dates, insufficient empty captures and changed geographic coverage. Existing freshness, CABA attribution, no-zero, source independence, restore and history checks must also pass.

After a live run inspect quality, sourceHealth, provenance and individual records, even if tests and artifact upload succeed. New feed inventories can deliberately make the first comparison unknown. GitHub cron is a request, not evidence of hourly sampling; quality.cadence flags observed gaps over ninety minutes. An unknown comparison remains a valid refusal to infer a trend.
