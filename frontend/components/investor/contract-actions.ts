"use client";

import { BrowserProvider, Contract } from "ethers";
import { ensureSepoliaNetwork } from "@/lib/auth";

export const SECURITY_TOKEN_ABI = [
  "function invest(uint256 propertyId, uint256 tokenAmount) payable",
  "function salePricePerTokenWei() view returns (uint256)",
  "function propertyId() view returns (uint256)",
] as const;

export const RENT_DISTRIBUTION_ABI = [
  "function payRent(uint256 propertyId) payable",
  "function claimRewards(uint256 propertyId)",
  "function propertyClaimableRewards(uint256 propertyId, address investor) view returns (uint256)",
  "function claimableRewards(address investor) view returns (uint256)",
  "function totalClaimedRewards(address investor) view returns (uint256)",
] as const;

export async function getConnectedSigner() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask is not installed.");
  }
  await ensureSepoliaNetwork();
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return signer;
}

export async function sendInvestmentTx(params: {
  tokenAddress: string;
  propertyId: number;
  tokenAmount: number;
  valueWei: string | bigint;
}) {
  const signer = await getConnectedSigner();
  const contract = new Contract(params.tokenAddress, SECURITY_TOKEN_ABI, signer);
  return contract.invest(params.propertyId, params.tokenAmount, { value: BigInt(params.valueWei) });
}

export async function sendPayRentTx(params: {
  rentContractAddress: string;
  propertyId: number;
  valueWei: string | bigint;
}) {
  const signer = await getConnectedSigner();
  const contract = new Contract(params.rentContractAddress, RENT_DISTRIBUTION_ABI, signer);
  return contract.payRent(params.propertyId, { value: BigInt(params.valueWei) });
}

export async function sendClaimRewardsTx(params: {
  rentContractAddress: string;
  propertyId: number;
}) {
  const signer = await getConnectedSigner();
  const contract = new Contract(params.rentContractAddress, RENT_DISTRIBUTION_ABI, signer);
  return contract.claimRewards(params.propertyId);
}
