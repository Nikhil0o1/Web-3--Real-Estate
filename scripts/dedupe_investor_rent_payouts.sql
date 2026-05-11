-- ══════════════════════════════════════════════════════════════════════
--  Phase B deduplication: investor_rent_payouts
-- ══════════════════════════════════════════════════════════════════════
--
-- Prerequisite for the unique index:
--   idx_investor_rent_payouts_dist_investor ON (distribution_id, investor_wallet)
--
-- This script removes duplicate payout rows (same distribution_id + investor_wallet),
-- keeping the earliest-created row (lowest id) as canonical.
--
-- Run with:
--   psql -h localhost -U postgres -d real_estate_web3 -f scripts/dedupe_investor_rent_payouts.sql
--
-- Review output BEFORE running the DELETE section in production.
-- ══════════════════════════════════════════════════════════════════════

\pset format aligned
\timing on

-- 1. Preview: show duplicates that will be removed.
SELECT
    distribution_id,
    investor_wallet,
    COUNT(*) AS duplicate_count,
    array_agg(id ORDER BY id) AS ids_to_inspect,
    MIN(id) AS id_to_keep,
    (array_agg(id ORDER BY id))[2:array_length(array_agg(id), 1)] AS ids_to_delete
FROM investor_rent_payouts
GROUP BY distribution_id, investor_wallet
HAVING COUNT(*) > 1
ORDER BY distribution_id, investor_wallet;

-- 2. Count summary.
SELECT
    'duplicate_rows_to_delete' AS metric,
    COUNT(*) - COUNT(DISTINCT (distribution_id, investor_wallet)) AS value
FROM investor_rent_payouts;

-- 3. Dedupe: delete duplicates, keeping the lowest id per (distribution_id, investor_wallet).
BEGIN;

DELETE FROM investor_rent_payouts a
USING investor_rent_payouts b
WHERE a.distribution_id = b.distribution_id
  AND a.investor_wallet = b.investor_wallet
  AND a.id > b.id;

-- 4. Verify: no duplicates remain.
SELECT COUNT(*) AS remaining_duplicates
FROM (
    SELECT distribution_id, investor_wallet, COUNT(*) AS c
    FROM investor_rent_payouts
    GROUP BY distribution_id, investor_wallet
    HAVING COUNT(*) > 1
) dup;

-- 5. Apply the unique index that enforces replay-safety going forward.
CREATE UNIQUE INDEX IF NOT EXISTS idx_investor_rent_payouts_dist_investor
    ON investor_rent_payouts (distribution_id, investor_wallet);

COMMIT;
