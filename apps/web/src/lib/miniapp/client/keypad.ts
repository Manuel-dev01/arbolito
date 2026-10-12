/**
 * Our own amount keypad (the system keyboard would cover the action bar). Values are kept as a
 * canonical "." decimal string; the decimal key's label follows the locale at render time.
 */
export type Key = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "del";

export const KEYS: readonly Key[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];

export interface KeypadRules {
  /** Max digits after the decimal key (2: cents). */
  maxDecimals: number;
  /** Max digits in total, ignoring the separator. */
  maxDigits: number;
}

export const DEFAULT_RULES: KeypadRules = { maxDecimals: 2, maxDigits: 8 };

/** Applies one key press. Returns the same string when the press is not allowed. */
export function pressKey(value: string, key: Key, rules: KeypadRules = DEFAULT_RULES): string {
  const v = value === "" ? "0" : value;
  if (key === "del") return v.length > 1 ? v.slice(0, -1) : "0";
  if (key === ".") {
    if (v.includes(".") || rules.maxDecimals === 0) return v;
    return `${v}.`;
  }
  if (v.includes(".") && v.split(".")[1]!.length >= rules.maxDecimals) return v;
  if (v.replace(".", "").length >= rules.maxDigits) return v;
  return v === "0" ? key : v + key;
}

/** True when the typed amount is a positive number the API will accept. */
export function isPositive(value: string): boolean {
  return /^\d+(\.\d*)?$/.test(value) && /[1-9]/.test(value);
}
