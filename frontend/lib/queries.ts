"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
  ClaimableRewardsSummary,
  DashboardSummary,
  InvestorDistribution,
  InvestorPayout,
  InvestorYieldSummary,
  PortfolioResponse,
  Property,
  RewardClaimHistory,
  RentAnalytics,
  RentDistribution,
  RentPayment,
  Transaction,
  UserRecord,
  WalletBalances,
} from "./types";

const POLL_MS = 12_000;

export const queryKeys = {
  config: ["config"] as const,
  dashboardSummary: ["dashboard", "summary"] as const,
  properties: ["properties"] as const,
  property: (id: number) => ["properties", id] as const,
  transactions: ["transactions"] as const,
  users: ["users"] as const,
  rentAnalytics: ["rent", "analytics"] as const,
  rentDistributions: ["rent", "distributions"] as const,
  rentPayments: ["rent", "payments"] as const,
  rentActiveRentals: ["rent", "active-rentals"] as const,
  investorPortfolio: (wallet?: string | null) => ["investor", "portfolio", wallet] as const,
  investorWalletBalances: (wallet?: string | null) => ["investor", "wallet-balances", wallet] as const,
  investorTransactions: (wallet?: string | null) => ["investor", "transactions", wallet] as const,
  investorYieldSummary: (wallet?: string | null) => ["investor", "yield-summary", wallet] as const,
  investorDistributions: (wallet?: string | null) => ["investor", "distributions", wallet] as const,
  investorPayouts: (wallet?: string | null) => ["investor", "payouts", wallet] as const,
  investorClaimable: (wallet?: string | null) => ["investor", "claimable", wallet] as const,
  investorClaimHistory: (wallet?: string | null) => ["investor", "claim-history", wallet] as const,
  status: ["status"] as const,
};

export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboardSummary,
    queryFn: () => api.get<DashboardSummary>("/dashboard/summary"),
    refetchInterval: POLL_MS,
  });
}

export function useProperties() {
  return useQuery({
    queryKey: queryKeys.properties,
    queryFn: () => api.get<Property[]>("/properties"),
    refetchInterval: POLL_MS,
  });
}

export function useTransactions() {
  return useQuery({
    queryKey: queryKeys.transactions,
    queryFn: () => api.get<Transaction[]>("/transactions"),
    refetchInterval: POLL_MS,
  });
}

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => api.get<UserRecord[]>("/users"),
    refetchInterval: POLL_MS,
  });
}

export function useRentAnalytics() {
  return useQuery({
    queryKey: queryKeys.rentAnalytics,
    queryFn: () => api.get<RentAnalytics>("/owner/rent-analytics"),
    refetchInterval: POLL_MS,
  });
}

export function useRentDistributions() {
  return useQuery({
    queryKey: queryKeys.rentDistributions,
    queryFn: () => api.get<RentDistribution[]>("/owner/distributions"),
    refetchInterval: POLL_MS,
  });
}

export function useRentPayments() {
  return useQuery({
    queryKey: queryKeys.rentPayments,
    queryFn: () => api.get<RentPayment[]>("/owner/rent-payments"),
    refetchInterval: POLL_MS,
  });
}

export function useActiveRentals() {
  return useQuery({
    queryKey: queryKeys.rentActiveRentals,
    queryFn: () => api.get<unknown[]>("/owner/active-rentals"),
    refetchInterval: POLL_MS,
  });
}

export function useStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: () => api.get<{ status: string; database: string; rpc: string; indexer?: { running?: boolean; last_block?: number } }>("/status"),
    refetchInterval: 30_000,
  });
}

export function usePortfolio(wallet?: string | null) {
  return useQuery({
    queryKey: queryKeys.investorPortfolio(wallet),
    queryFn: () => api.get<PortfolioResponse>(`/portfolio/${wallet}`),
    enabled: !!wallet,
    refetchInterval: POLL_MS,
  });
}

export function useWalletBalances(wallet?: string | null) {
  return useQuery({
    queryKey: queryKeys.investorWalletBalances(wallet),
    queryFn: () => api.get<WalletBalances>(`/wallets/${wallet}/balances`),
    enabled: !!wallet,
    refetchInterval: POLL_MS,
  });
}

export function useInvestorTransactions(wallet?: string | null) {
  return useQuery({
    queryKey: queryKeys.investorTransactions(wallet),
    queryFn: () => api.get<Transaction[]>("/transactions", { wallet_address: wallet || undefined }),
    enabled: !!wallet,
    refetchInterval: POLL_MS,
  });
}

export function useInvestorYieldSummary(wallet?: string | null) {
  return useQuery({
    queryKey: queryKeys.investorYieldSummary(wallet),
    queryFn: () => api.get<InvestorYieldSummary>(`/investor/yield-summary/${wallet}`),
    enabled: !!wallet,
    refetchInterval: POLL_MS,
  });
}

export function useInvestorDistributions(wallet?: string | null) {
  return useQuery({
    queryKey: queryKeys.investorDistributions(wallet),
    queryFn: () => api.get<InvestorDistribution[]>(`/investor/distributions/${wallet}`),
    enabled: !!wallet,
    refetchInterval: POLL_MS,
  });
}

export function useInvestorPayouts(wallet?: string | null) {
  return useQuery({
    queryKey: queryKeys.investorPayouts(wallet),
    queryFn: () => api.get<InvestorPayout[]>(`/investor/rental-earnings/${wallet}`),
    enabled: !!wallet,
    refetchInterval: POLL_MS,
  });
}

export function useClaimableRewards(wallet?: string | null) {
  return useQuery({
    queryKey: queryKeys.investorClaimable(wallet),
    queryFn: () => api.get<ClaimableRewardsSummary>(`/rewards/claimable/${wallet}`),
    enabled: !!wallet,
    refetchInterval: POLL_MS,
  });
}

export function useClaimHistory(wallet?: string | null) {
  return useQuery({
    queryKey: queryKeys.investorClaimHistory(wallet),
    queryFn: () => api.get<RewardClaimHistory[]>(`/rewards/history/${wallet}`),
    enabled: !!wallet,
    refetchInterval: POLL_MS,
  });
}
