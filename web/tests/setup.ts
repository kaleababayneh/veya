import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
// Explicit storage avoids Node 25's unrelated experimental localStorage global.
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, String(v)),
    removeItem: (k: string) => data.delete(k),
    clear: () => data.clear(),
    key: (n: number) => [...data.keys()][n] ?? null,
    get length() {
      return data.size;
    },
  };
}
Object.defineProperty(globalThis, "localStorage", {
  value: storage(),
  configurable: true,
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: storage(),
  configurable: true,
});
// Keep Buffer and Uint8Array in the same realm for Stellar's noble hash validation.
Object.defineProperty(globalThis, "Uint8Array", {
  value: Object.getPrototypeOf(Buffer.prototype).constructor,
  configurable: true,
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
