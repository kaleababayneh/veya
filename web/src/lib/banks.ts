/**
 * Turkish banks by IBAN bank code (digits 4..9 of a TR IBAN). Display only: the escrow binds the payee by IBAN +
 * name, and a buyer's FAST can reach any of them; the maker's choice travels inside the sealed payee details.
 * `supported` is a product decision (which banks the app presents as live); flip it to open more up.
 */
export type Bank = { code: string; name: string; short: string; initials: string; color: string; supported: boolean };

export const BANKS: Bank[] = [
  { code: "00001", name: "Ziraat Bankası", short: "Ziraat", initials: "Z", color: "#d0021b", supported: true },
  { code: "00015", name: "VakıfBank", short: "VakıfBank", initials: "V", color: "#f2b800", supported: true },
  { code: "00012", name: "Halkbank", short: "Halkbank", initials: "H", color: "#1a5fb4", supported: false },
  { code: "00064", name: "İş Bankası", short: "İş Bankası", initials: "İŞ", color: "#2b4a9d", supported: false },
  { code: "00062", name: "Garanti BBVA", short: "Garanti", initials: "G", color: "#1d8a4a", supported: false },
  { code: "00046", name: "Akbank", short: "Akbank", initials: "A", color: "#e0001b", supported: false },
  { code: "00067", name: "Yapı Kredi", short: "Yapı Kredi", initials: "YK", color: "#0a3d91", supported: false },
  { code: "00111", name: "QNB", short: "QNB", initials: "Q", color: "#6a1b9a", supported: false },
  { code: "00134", name: "DenizBank", short: "DenizBank", initials: "D", color: "#0072bc", supported: false },
  { code: "00032", name: "TEB", short: "TEB", initials: "T", color: "#2e7d32", supported: false },
  { code: "00099", name: "ING", short: "ING", initials: "I", color: "#ff6200", supported: false },
  { code: "00205", name: "Kuveyt Türk", short: "Kuveyt Türk", initials: "KT", color: "#0b7a3b", supported: false },
  { code: "00203", name: "Albaraka Türk", short: "Albaraka", initials: "AB", color: "#3b3b3b", supported: false },
  { code: "00206", name: "Türkiye Finans", short: "Türkiye Finans", initials: "TF", color: "#2196f3", supported: false },
  { code: "00209", name: "Ziraat Katılım", short: "Ziraat Katılım", initials: "ZK", color: "#d0021b", supported: false },
  { code: "00210", name: "Vakıf Katılım", short: "Vakıf Katılım", initials: "VK", color: "#f2b800", supported: false },
];

/** The bank a TR IBAN belongs to, from its bank code; `null` for a malformed IBAN or an unlisted bank. */
export function bankFromIban(iban: string): Bank | null {
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^TR\d{24}$/.test(clean)) return null;
  const code = clean.slice(4, 9);
  return BANKS.find((b) => b.code === code) ?? null;
}

export const bankByName = (name: string | undefined | null): Bank | null => (name ? (BANKS.find((b) => b.name === name || b.short === name) ?? null) : null);
