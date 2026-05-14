"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { queryKeys } from "./queries";
import type { Property } from "./types";

export type CreatePropertyPayload = {
  name: string;
  location: string;
  total_value: string | number;
  token_supply: string | number;
  token_symbol: string;
  token_sale_price_eth: string | number;
  monthly_rent_eth?: string | number | null;
};

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePropertyPayload) => api.post<Property>("/properties", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.properties }),
  });
}

export function useUpdateProperty(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreatePropertyPayload) =>
      api.put<Property>(`/properties/${id}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.properties }),
  });
}

export function useDeployPropertyToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (propertyId: number) =>
      api.post<Property>(`/properties/${propertyId}/deploy-token`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.properties }),
  });
}

export function useRepairSaleInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (propertyId: number) =>
      api.post<Property>(`/properties/${propertyId}/repair-sale-inventory`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.properties }),
  });
}

export function useMintPropertyNft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { property_id: number; to_address: string; token_uri: string }) =>
      api.post<Property>(`/properties/${payload.property_id}/mint-nft`, {
        to_address: payload.to_address,
        token_uri: payload.token_uri,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.properties }),
  });
}

export function useSyncRentChain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (propertyId: number) =>
      api.post<{ status: string; investor_count: number }>(`/properties/${propertyId}/sync-rent-chain`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.properties });
      qc.invalidateQueries({ queryKey: queryKeys.rentAnalytics });
    },
  });
}

export function useSetRent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { property_id: number; monthly_rent_eth: string | number }) =>
      api.post(`/properties/${payload.property_id}/set-rent`, {
        monthly_rent_eth: payload.monthly_rent_eth,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.properties });
      qc.invalidateQueries({ queryKey: queryKeys.rentAnalytics });
    },
  });
}

export function useIssueTokens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      property_id: number;
      to_address: string;
      amount: string | number;
      email?: string | null;
    }) =>
      api.post<Property>(`/properties/${payload.property_id}/issue-tokens`, {
        to_address: payload.to_address,
        amount: payload.amount,
        email: payload.email ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.properties }),
  });
}

export function useUpdateGovernanceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: Record<string, Record<string, unknown>>) =>
      api.put<{ ok: boolean }>("/api/agents/governance/settings", { settings }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.governanceSettings });
      qc.invalidateQueries({ queryKey: queryKeys.governanceOverview });
      qc.invalidateQueries({ queryKey: queryKeys.governanceNotifications });
      qc.invalidateQueries({ queryKey: queryKeys.governanceTimeline });
      qc.invalidateQueries({ queryKey: queryKeys.governanceRisk });
      qc.invalidateQueries({ queryKey: queryKeys.governanceBrief });
    },
  });
}
