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

export type UserRecord = {
  id: number;
  wallet_address: string;
  email?: string | null;
  kyc_status: string;
};
