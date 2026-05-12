"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
  DashboardSummary,
  Property,
  RentAnalytics,
  RentDistribution,
  RentPayment,
  Transaction,
  UserRecord,
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
    queryKey: ["portfolio", wallet],
    queryFn: () => api.get<{ wallet_address: string; holdings: Array<{ property_id: number; property_name: string; token_amount: string }> }>(`/portfolio/${wallet}`),
    enabled: !!wallet,
    refetchInterval: POLL_MS,
  });
}
