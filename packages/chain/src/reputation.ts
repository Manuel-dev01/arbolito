import { encodeFunctionData, keccak256, toBytes, type Address, type Hex } from "viem";
import { CONTRACTS } from "@arbolito/config";

/**
 * ERC-8004 Reputation Registry v2.0.0 on Celo (getVersion() read 2026-11-03; implementation
 * 0x16e0…da34 behind the proxy). giveFeedback needs no pre-authorization from the agent; an
 * agent's owner or operator is refused ("Self-feedback not allowed").
 */
export const REPUTATION_REGISTRY = CONTRACTS.erc8004.reputation as Address;

export const reputationAbi = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
] as const;

export interface Feedback {
  agentId: bigint;
  /** 0–100 (valueDecimals 0). */
  score: number;
  tag1: string;
  tag2: string;
  /** The service the feedback is about. */
  endpoint: string;
  /** Where the evidence lives (a receipt page, a payment tx), hashed into feedbackHash. */
  feedbackURI: string;
}

/** Calldata for giveFeedback; feedbackHash is keccak256 of the feedbackURI string. */
export function encodeGiveFeedback(f: Feedback): Hex {
  if (!Number.isInteger(f.score) || f.score < 0 || f.score > 100) throw new Error("score must be an integer 0–100");
  return encodeFunctionData({
    abi: reputationAbi,
    functionName: "giveFeedback",
    args: [f.agentId, BigInt(f.score), 0, f.tag1, f.tag2, f.endpoint, f.feedbackURI, f.feedbackURI ? keccak256(toBytes(f.feedbackURI)) : `0x${"0".repeat(64)}`],
  });
}
