\pset format aligned
\timing on
\pset pager off
-- Properties duplicates by key fields
SELECT 'properties' AS table_name, name, location, total_value, token_supply, token_symbol, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
FROM properties
GROUP BY name, location, total_value, token_supply, token_symbol
HAVING count(*) > 1;

-- Investments duplicates where deposit_tx_hash IS NULL
SELECT 'investments_null_deposit_tx' AS table_name, property_id, investor_wallet, token_amount_base, eth_amount_wei, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
FROM investments
WHERE deposit_tx_hash IS NULL
GROUP BY property_id, investor_wallet, token_amount_base, eth_amount_wei
HAVING count(*) > 1;

-- Investments duplicates by deposit_tx_hash (should be unique)
SELECT 'investments_by_tx' AS table_name, deposit_tx_hash, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
FROM investments
WHERE deposit_tx_hash IS NOT NULL
GROUP BY deposit_tx_hash
HAVING count(*) > 1;

-- Users duplicates (wallet)
SELECT 'users' AS table_name, wallet_address, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
FROM users
GROUP BY wallet_address
HAVING count(*) > 1;

-- Tenants duplicates (wallet)
SELECT 'tenants' AS table_name, wallet_address, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
FROM tenants
GROUP BY wallet_address
HAVING count(*) > 1;

-- Token ownerships duplicates (user_id, property_id)
SELECT 'token_ownerships' AS table_name, user_id, property_id, array_agg(ctid::text ORDER BY ctid::text) AS ctids, count(*) AS cnt
FROM token_ownerships
GROUP BY user_id, property_id
HAVING count(*) > 1;

-- Transactions duplicates by tx_hash
SELECT 'transactions' AS table_name, tx_hash, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
FROM transactions
GROUP BY tx_hash
HAVING count(*) > 1;

-- Rent payments duplicates by tx_hash
SELECT 'rent_payments' AS table_name, tx_hash, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
FROM rent_payments
GROUP BY tx_hash
HAVING count(*) > 1;

-- Rent distributions duplicates by distribution_tx_hash
SELECT 'rent_distributions' AS table_name, distribution_tx_hash, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
FROM rent_distributions
GROUP BY distribution_tx_hash
HAVING count(*) > 1;

-- Investor rent payouts duplicates
SELECT 'investor_rent_payouts' AS table_name, distribution_id, investor_wallet, property_id, payout_amount_wei, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
FROM investor_rent_payouts
GROUP BY distribution_id, investor_wallet, property_id, payout_amount_wei
HAVING count(*) > 1;

-- Blockchain event log duplicates (tx_hash, log_index)
SELECT 'blockchain_event_log' AS table_name, tx_hash, log_index, array_agg(id ORDER BY id) AS ids, count(*) AS cnt
FROM blockchain_event_log
GROUP BY tx_hash, log_index
HAVING count(*) > 1;

-- Show row counts for key tables
SELECT 'counts' AS info, 'properties' AS table_name, count(*) FROM properties
UNION ALL
SELECT 'counts', 'investments', count(*) FROM investments
UNION ALL
SELECT 'counts', 'users', count(*) FROM users
UNION ALL
SELECT 'counts', 'transactions', count(*) FROM transactions
UNION ALL
SELECT 'counts', 'rent_payments', count(*) FROM rent_payments
UNION ALL
SELECT 'counts', 'rent_distributions', count(*) FROM rent_distributions;
