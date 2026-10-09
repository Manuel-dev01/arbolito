/**
 * thirdweb smart accounts (ERC-4337) driven by an Arbolito session key, self-bundled:
 * Arbolito's relayer EOA calls `EntryPoint.handleOps` directly. No third-party bundler or
 * paymaster. UserOps carry `maxFeePerGas = maxPriorityFeePerGas = 0`, so the EntryPoint
 * charges the account nothing and the account needs no CELO; the relayer pays the real gas.
 *
 * Contract behaviour here was read from the verified source of thirdweb's Account
 * implementations on Celo (v0.6 `0xf221…a346`, v0.7 `0x94eC…beb2`) and proven on a fork in
 * `test/smartAccount.fork.test.ts`. Session-key rules enforced onchain (AccountCore.isValidSigner):
 *   - callData must be `execute` or `executeBatch` on the account;
 *   - every call target must be in `approvedTargets` (or the wildcard [address(0)]);
 *   - each call's native value must be ≤ `nativeTokenLimitPerTransaction`;
 *   - start ≤ block.timestamp < end.
 * The inner calldata is NOT inspected: a key approved for a router can call any router function
 * with any recipient. See the fork test for what that allows.
 */
import {
  concat,
  encodeFunctionData,
  parseAbi,
  toHex,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
} from "viem";
import {
  entryPoint06Abi,
  entryPoint06Address,
  entryPoint07Abi,
  entryPoint07Address,
  getUserOperationHash,
  toPackedUserOperation,
  type UserOperation,
} from "viem/account-abstraction";
import { withAttribution } from "./attribution";

export type EntryPointVersion = "0.6" | "0.7";

export interface ThirdwebAccountKind {
  version: EntryPointVersion;
  /** thirdweb's default AccountFactory for this EntryPoint (SDK 5.121.6). */
  factory: Address;
  /** The factory's `accountImplementation()` (EIP-1167 clones point here). */
  accountImplementation: Address;
  entryPoint: Address;
}

/** Read from Celo mainnet 2026-10-09: factory.accountImplementation(), factory.entrypoint(), impl.entryPoint(). */
export const THIRDWEB_ACCOUNT_V06: ThirdwebAccountKind = {
  version: "0.6",
  factory: "0x85e23b94e7F5E9cC1fF78BCe78cfb15B81f0DF00",
  accountImplementation: "0xf22175c80c6e074C171811C59C6c0087e2a6a346",
  entryPoint: entryPoint06Address,
};

export const THIRDWEB_ACCOUNT_V07: ThirdwebAccountKind = {
  version: "0.7",
  factory: "0x4bE0ddfebcA9A5A4a617dee4DeCe99E7c862dceb",
  accountImplementation: "0x94eC38a5d2EDA5A543Ab4c08D998338D4082beb2",
  entryPoint: entryPoint07Address,
};

export const thirdwebFactoryAbi = parseAbi([
  "function createAccount(address admin, bytes data) returns (address)",
  "function getAddress(address adminSigner, bytes data) view returns (address)",
]);

export const thirdwebAccountAbi = parseAbi([
  "struct SignerPermissionRequest { address signer; uint8 isAdmin; address[] approvedTargets; uint256 nativeTokenLimitPerTransaction; uint128 permissionStartTimestamp; uint128 permissionEndTimestamp; uint128 reqValidityStartTimestamp; uint128 reqValidityEndTimestamp; bytes32 uid; }",
  "struct SignerPermissions { address signer; address[] approvedTargets; uint256 nativeTokenLimitPerTransaction; uint128 startTimestamp; uint128 endTimestamp; }",
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch(address[] targets, uint256[] values, bytes[] data)",
  "function setPermissionsForSigner(SignerPermissionRequest req, bytes signature)",
  "function getPermissionsForSigner(address signer) view returns (SignerPermissions)",
  "function isActiveSigner(address signer) view returns (bool)",
  "function isAdmin(address signer) view returns (bool)",
]);

/** EIP-712 type of AccountPermissions.TYPEHASH (domain: name "Account", version "1"). */
export const SIGNER_PERMISSION_REQUEST_TYPES = {
  SignerPermissionRequest: [
    { name: "signer", type: "address" },
    { name: "isAdmin", type: "uint8" },
    { name: "approvedTargets", type: "address[]" },
    { name: "nativeTokenLimitPerTransaction", type: "uint256" },
    { name: "permissionStartTimestamp", type: "uint128" },
    { name: "permissionEndTimestamp", type: "uint128" },
    { name: "reqValidityStartTimestamp", type: "uint128" },
    { name: "reqValidityEndTimestamp", type: "uint128" },
    { name: "uid", type: "bytes32" },
  ],
} as const;

export interface SignerPermissionRequest {
  signer: Address;
  /** 0 = session key, 1 = add admin, 2 = remove admin. */
  isAdmin: number;
  approvedTargets: readonly Address[];
  nativeTokenLimitPerTransaction: bigint;
  permissionStartTimestamp: bigint;
  permissionEndTimestamp: bigint;
  reqValidityStartTimestamp: bigint;
  reqValidityEndTimestamp: bigint;
  /** Single-use: the account records it and rejects a replay. */
  uid: Hex;
}

export interface Call {
  to: Address;
  value?: bigint;
  data: Hex;
}

/** UserOp in one shape for both versions. `initCode` = factory ‖ factoryData, or "0x" when deployed. */
export interface UserOp {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  signature: Hex;
}

function randomUid(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** Counterfactual account address (same CREATE2 salt the factory uses: keccak(admin, data)). */
export async function predictAccountAddress(
  client: PublicClient,
  kind: ThirdwebAccountKind,
  admin: Address,
  salt: Hex = "0x",
): Promise<Address> {
  return client.readContract({ address: kind.factory, abi: thirdwebFactoryAbi, functionName: "getAddress", args: [admin, salt] });
}

/** `initCode` for the first UserOp: deploys the account inside handleOps. */
export function accountInitCode(kind: ThirdwebAccountKind, admin: Address, salt: Hex = "0x"): Hex {
  return concat([
    kind.factory,
    encodeFunctionData({ abi: thirdwebFactoryAbi, functionName: "createAccount", args: [admin, salt] }),
  ]);
}

/** Session-key grant (isAdmin = 0). The admin signs it; anyone may submit it. */
export function sessionKeyRequest(p: {
  signer: Address;
  approvedTargets: readonly Address[];
  validFrom: bigint;
  validUntil: bigint;
  nativeTokenLimitPerTransaction?: bigint;
  /** Window in which the signed request can be submitted. Defaults to validFrom..validUntil. */
  reqValidFrom?: bigint;
  reqValidUntil?: bigint;
  uid?: Hex;
}): SignerPermissionRequest {
  return {
    signer: p.signer,
    isAdmin: 0,
    approvedTargets: p.approvedTargets,
    nativeTokenLimitPerTransaction: p.nativeTokenLimitPerTransaction ?? 0n,
    permissionStartTimestamp: p.validFrom,
    permissionEndTimestamp: p.validUntil,
    reqValidityStartTimestamp: p.reqValidFrom ?? 0n,
    reqValidityEndTimestamp: p.reqValidUntil ?? p.validUntil,
    uid: p.uid ?? randomUid(),
  };
}

/** Revocation, as thirdweb's removeSessionKey does it: no targets, zero window. */
export function revokeSessionKeyRequest(signer: Address, reqValidUntil: bigint, uid?: Hex): SignerPermissionRequest {
  return sessionKeyRequest({ signer, approvedTargets: [], validFrom: 0n, validUntil: 0n, reqValidUntil, uid });
}

export function permissionTypedData(chainId: number, account: Address, req: SignerPermissionRequest) {
  return {
    domain: { name: "Account", version: "1", chainId, verifyingContract: account },
    types: SIGNER_PERMISSION_REQUEST_TYPES,
    primaryType: "SignerPermissionRequest" as const,
    message: { ...req, isAdmin: req.isAdmin, approvedTargets: [...req.approvedTargets] },
  };
}

/** The admin's EIP-712 signature over a permission request. Works before the account is deployed. */
export async function signPermissionRequest(
  admin: LocalAccount,
  chainId: number,
  account: Address,
  req: SignerPermissionRequest,
): Promise<Hex> {
  return admin.signTypedData(permissionTypedData(chainId, account, req));
}

export function encodeSetPermissionsForSigner(req: SignerPermissionRequest, signature: Hex): Hex {
  return encodeFunctionData({
    abi: thirdwebAccountAbi,
    functionName: "setPermissionsForSigner",
    args: [{ ...req, approvedTargets: [...req.approvedTargets] }, signature],
  });
}

/** Account callData for one call (`execute`) or several (`executeBatch`). */
export function encodeAccountCalls(calls: readonly Call[]): Hex {
  if (calls.length === 1) {
    const [c] = calls as [Call];
    return encodeFunctionData({ abi: thirdwebAccountAbi, functionName: "execute", args: [c.to, c.value ?? 0n, c.data] });
  }
  return encodeFunctionData({
    abi: thirdwebAccountAbi,
    functionName: "executeBatch",
    args: [calls.map((c) => c.to), calls.map((c) => c.value ?? 0n), calls.map((c) => c.data)],
  });
}

export async function getAccountNonce(client: PublicClient, kind: ThirdwebAccountKind, sender: Address, key = 0n): Promise<bigint> {
  return client.readContract({
    address: kind.entryPoint,
    abi: kind.version === "0.6" ? entryPoint06Abi : entryPoint07Abi,
    functionName: "getNonce",
    args: [sender, key],
  });
}

/**
 * Unsigned zero-fee UserOp. Gas limits are ceilings, not costs: at a zero gas price the
 * EntryPoint charges the account nothing, so generous defaults are free. They must still cover
 * real execution (the relayer's outer tx has to carry them, or the EntryPoint reverts AA95).
 */
export function buildZeroFeeUserOp(p: {
  sender: Address;
  nonce: bigint;
  callData: Hex;
  initCode?: Hex;
  callGasLimit?: bigint;
  verificationGasLimit?: bigint;
  /** Appended to callData (the account's ABI decoder ignores trailing bytes). */
  attributionCode?: string;
}): UserOp {
  const initCode = p.initCode ?? "0x";
  return {
    sender: p.sender,
    nonce: p.nonce,
    initCode,
    callData: p.attributionCode ? withAttribution(p.callData, p.attributionCode) : p.callData,
    callGasLimit: p.callGasLimit ?? 600_000n,
    verificationGasLimit: p.verificationGasLimit ?? (initCode === "0x" ? 250_000n : 800_000n),
    preVerificationGas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    signature: "0x",
  };
}

function toViemOp(kind: ThirdwebAccountKind, op: UserOp): UserOperation {
  if (kind.version === "0.6") {
    return { ...op, paymasterAndData: "0x" } as UserOperation<"0.6">;
  }
  const { initCode, ...rest } = op;
  const factory = initCode === "0x" ? undefined : (initCode.slice(0, 42) as Address);
  const factoryData = initCode === "0x" ? undefined : (`0x${initCode.slice(42)}` as Hex);
  return { ...rest, factory, factoryData } as UserOperation<"0.7">;
}

export function userOpHash(kind: ThirdwebAccountKind, chainId: number, op: UserOp): Hex {
  return getUserOperationHash({
    chainId,
    entryPointAddress: kind.entryPoint,
    entryPointVersion: kind.version,
    userOperation: toViemOp(kind, op),
  });
}

/** thirdweb accounts recover `toEthSignedMessageHash(userOpHash)`: an EIP-191 personal_sign. */
export async function signUserOp(signer: LocalAccount, kind: ThirdwebAccountKind, chainId: number, op: UserOp): Promise<UserOp> {
  const signature = await signer.signMessage({ message: { raw: userOpHash(kind, chainId, op) } });
  return { ...op, signature };
}

/**
 * `handleOps` calldata for the relayer's transaction, with the ERC-8021 suffix appended to the
 * outer calldata when `attributionCode` is given (the EntryPoint ignores trailing bytes).
 */
export function encodeHandleOps(kind: ThirdwebAccountKind, ops: readonly UserOp[], beneficiary: Address, attributionCode?: string): Hex {
  const data =
    kind.version === "0.6"
      ? encodeFunctionData({
          abi: entryPoint06Abi,
          functionName: "handleOps",
          args: [ops.map((op) => ({ ...op, paymasterAndData: "0x" as Hex })), beneficiary],
        })
      : encodeFunctionData({
          abi: entryPoint07Abi,
          functionName: "handleOps",
          args: [ops.map((op) => toPackedUserOperation(toViemOp(kind, op))), beneficiary],
        });
  return attributionCode ? withAttribution(data, attributionCode) : data;
}
