export type Role = "property_owner" | "investor" | "tenant";

export type AuthUser = {
  id?: number;
  wallet_address: string;
  role: Role | string;
  email?: string | null;
  kyc_status?: string;
  active?: boolean;
};

export type Property = {
  id: number;
  name: string;
  location: string;
  total_value: string | number;
  token_supply: string | number;
  token_symbol: string;
  token_address?: string | null;
  nft_token_id?: number | null;
  nft_contract_address?: string | null;
  token_sale_price_wei?: string | null;
  token_sale_price_eth?: string | null;
  monthly_rent_wei?: string | null;
  monthly_rent_eth?: string | null;
  tokens_sold: string | number;
  tokens_available: string | number;
  sold_percentage: string | number;
  rent_enabled?: boolean;
};

export type Transaction = {
  id: number;
  tx_hash: string;
  type: string;
  amount: string | number;
  timestamp: string;
  property_id?: number | null;
  block_number?: number | null;
  property_name?: string | null;
  wallet_address?: string | null;
  gas_fee?: string | null;
  amount_spent?: string | null;
  remaining_balance?: string | null;
  action_label: string;
  display_amount: string | number;
  amount_unit: string;
  status: string;
  description: string;
};

export type DashboardSummary = {
  total_portfolio_value: string | number;
  total_token_holdings: string | number;
  properties_loaded: number;
  avg_min_spend_per_token: string | number;
};

export type RentAnalytics = {
  total_rent_collected_wei: string;
  total_rent_distributed_wei: string;
  total_payments: number;
  total_distributions: number;
  active_rentals: number;
};

export type RentDistribution = {
  id: number;
  property_id: number;
  property_name?: string | null;
  total_rent_collected: string;
  total_distributed: string;
  investor_count: number;
  distribution_tx_hash: string;
  distributed_at: string;
};

export type RentPayment = {
  id: number;
  tenant_wallet: string;
  property_id: number;
  property_name?: string | null;
  amount_wei: string;
  amount_eth: string;
  tx_hash: string;
  block_number?: number | null;
  payment_date: string;
  payment_status: string;
};

export type PortfolioItem = {
  property_id: number;
  property_name: string;
  token_amount: string;
};

export type PortfolioResponse = {
  wallet_address: string;
  holdings: PortfolioItem[];
};

export type WalletBalanceToken = {
  category: string;
  property_id?: number | null;
  property_name?: string | null;
  symbol?: string | null;
  token_address?: string | null;
  decimals?: number;
  balance_base?: string;
  balance: string;
};

export type WalletBalances = {
  wallet_address: string;
  native: {
    symbol: string;
    balance_wei: string;
    balance: string;
  };
  tokens: WalletBalanceToken[];
};

export type InvestorYieldSummary = {
  wallet_address: string;
  total_earned_wei: string;
  total_earned_eth: string;
  total_claimable_wei?: string;
  total_claimable_eth?: string;
  total_claimed_wei?: string;
  total_claimed_eth?: string;
  total_payouts: number;
  properties_earning: number;
};

export type InvestorDistribution = {
  property_id: number;
  property_name?: string | null;
  total_earned_wei: string;
  total_earned_eth: string;
  payment_count: number;
  current_ownership: string | number;
};

export type InvestorPayout = {
  id: number;
  investor_wallet: string;
  property_id: number;
  property_name?: string | null;
  ownership_percentage: string | number;
  payout_amount_wei: string;
  payout_amount_eth: string;
  tx_hash: string;
  distributed_at: string;
  claim_status: string;
  claim_tx_hash?: string | null;
  claimed_at?: string | null;
};

export type ClaimableRewardProperty = {
  property_id: number;
  property_name?: string | null;
  claimable_amount_wei: string;
  claimable_amount_eth: string;
  pending_payouts: number;
  last_distributed_at?: string | null;
};

export type ClaimableRewardsSummary = {
  wallet_address: string;
  total_claimable_wei: string;
  total_claimable_eth: string;
  total_claimed_wei: string;
  total_claimed_eth: string;
  properties: ClaimableRewardProperty[];
};

export type RewardClaimHistory = {
  property_id: number;
  property_name?: string | null;
  claim_tx_hash: string;
  claimed_amount_wei: string;
  claimed_amount_eth: string;
  payout_count: number;
  claimed_at: string;
};

export type InvestmentPrepareResponse = {
  investment_id: number;
  property_id: number;
  investor_wallet: string;
  token_amount: string | number;
  eth_amount: string | number;
  eth_amount_wei: string;
  recipient_address: string;
  chain_id: number;
};

export type InvestmentRead = {
  id: number;
  property_id: number;
  investor_wallet: string;
  token_amount: string | number;
  eth_amount: string | number;
  eth_amount_wei: string;
  deposit_tx_hash?: string | null;
  status: string;
  created_at: string;
};

export type ClaimRewardsPrepareResponse = {
  property_id: number;
  property_name: string;
  investor_wallet: string;
  claimable_amount_wei: string;
  claimable_amount_eth: string;
  rent_contract_address: string;
  calldata: string;
  chain_id: number;
};

export type ClaimRewardsConfirmResponse = {
  status: string;
  property_id: number;
  investor_wallet: string;
  claim_tx_hash: string;
  claimed_amount_wei: string;
  claimed_amount_eth: string;
  claimed_rows: number;
};

export type UserRecord = {
  id: number;
  wallet_address: string;
  email?: string | null;
  kyc_status: string;
};

export type TenantRental = {
  id: number;
  tenant_id: number;
  property_id: number;
  property_name?: string | null;
  location?: string | null;
  rental_start_date?: string | null;
  rental_end_date?: string | null;
  status: string;
  created_at?: string | null;
};

export type PayRentPrepareResponse = {
  property_id: number;
  property_name: string;
  monthly_rent_wei: string;
  monthly_rent_eth: string;
  rent_contract_address: string;
  calldata: string;
  chain_id: number;
};

export type PayRentConfirmRequest = {
  tx_hash: string;
  tenant_wallet: string;
};

export type PayRentConfirmResponse = {
  status: string;
  rent_payment_id: number;
  distribution_id?: number | null;
  amount_wei: string;
  amount_eth: string;
  investors_paid: number;
  total_distributed_wei?: string;
  tx_hash: string;
};

export type RentDistributionPreview = {
  property_id: number;
  property_name: string;
  monthly_rent_wei: string;
  monthly_rent_eth: string;
  investor_count: number;
  breakdown: Array<{
    investor: string;
    payout_eth: string;
    ownership_pct: string | number;
  }>;
};

export type AutonomousIntelEvent = {
  id: number;
  agent: string;
  severity: string;
  category: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  draft_payload?: Record<string, unknown> | null;
  read_at?: string | null;
  created_at?: string | null;
  unread: boolean;
};

export type GovernanceProviderRollup = {
  provider: string;
  samples_7d: number;
  fallback_count_7d: number;
  fallback_rate_7d: number;
  avg_latency_ms_7d: number;
  prompt_tokens_7d: number;
  completion_tokens_7d: number;
  estimated_cost_usd_7d: number;
};

export type GovernanceOverview = {
  window_hours: number;
  orchestration_runs_24h: number;
  orchestration_ok_runs_24h: number;
  orchestration_ok_rate_24h: number | null;
  orchestration_stream_runs_24h: number;
  avg_tool_step_latency_ms_24h: number | null;
  governance_events_24h: number;
  governance_metric_samples_24h: number;
  intel_events_24h: number;
  governance_severity_counts_7d: Record<string, number>;
  provider_rollups_7d: GovernanceProviderRollup[];
  runtime_env_hints: {
    orchestration_enabled: boolean;
    ai_llm_synthesis_enabled: boolean;
    env_provider: string;
    env_fallback_provider: string | null;
  };
};

export type GovernanceTimelineEntry = {
  id: string | null;
  source: string;
  kind: string;
  severity: string;
  created_at: string | null;
  payload: Record<string, unknown>;
  user_id: number | null;
  trace_id: string | null;
  title: string | null;
};

export type GovernanceTimelineResponse = { items: GovernanceTimelineEntry[] };

export type GovernanceAuditRunRow = {
  id: number;
  trace_id: string | null;
  graph_thread_id: string | null;
  memory_thread_id: number | null;
  user_id: number | null;
  wallet_address: string | null;
  execution_mode: string | null;
  graph_profile: string | null;
  status: string | null;
  error: string | null;
  created_at: string | null;
};

export type GovernanceAuditRunsResponse = { items: GovernanceAuditRunRow[] };

export type GovernanceProvidersResponse = {
  rollups: GovernanceProviderRollup[];
  runtime_env_hints: GovernanceOverview["runtime_env_hints"];
};

export type GovernanceRiskSignal = {
  signal_id: string;
  severity: string;
  summary: string;
  user_id?: number;
  wallet_address?: string | null;
  metrics?: Record<string, unknown>;
};

export type GovernanceRiskSignalsResponse = { signals: GovernanceRiskSignal[] };

export type GovernanceNotificationItem = {
  id: number | null;
  category: string;
  severity: string;
  title: string;
  detail: Record<string, unknown>;
  created_at: string | null;
  user_id: number | null;
  trace_id: string | null;
};

export type GovernanceNotificationsResponse = { items: GovernanceNotificationItem[] };

export type GovernanceObservabilityResponse = {
  orchestration: Record<string, unknown>;
  metrics: { samples_by_key_24h: Array<{ metric_key: string; samples_24h: number }> };
  intel_events_24h?: number;
  governance_events_24h?: number;
};

export type GovernanceAdminBrief = { format: string; text: string };

export type GovernanceSettingEnvelope = {
  value: Record<string, unknown>;
  updated_at?: string | null;
  updated_by_user_id?: number | null;
};

export type GovernanceSettingsResponse = { settings: Record<string, GovernanceSettingEnvelope> };
