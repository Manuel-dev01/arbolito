export const CELO_MAINNET_ID = 42220;
export const CELO_SEPOLIA_ID = 11142220;
export const EXPLORER_URL = "https://celoscan.io";

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const addressUrl = (addr: string) => `${EXPLORER_URL}/address/${addr}`;
