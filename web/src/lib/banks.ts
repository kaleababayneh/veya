/**
 * Turkish banks by IBAN bank code (digits 4..9 of a TR IBAN). Display only: the escrow binds the payee by IBAN +
 * name, and a buyer's FAST can reach any of them; the maker's choice travels inside the sealed payee details.
 * `supported` is a product decision (which banks the app presents as live); flip it to open more up.
 */
export type Bank = { code: string; name: string; short: string; initials: string; color: string; logo: string; supported: boolean };

export const BANKS: Bank[] = [
  { code: "00010", name: "Ziraat Bankası", short: "Ziraat", initials: "Z", color: "#d0021b", logo: "/banks/00010.svg", supported: true },
  { code: "00015", name: "VakıfBank", short: "VakıfBank", initials: "V", color: "#f2b800", logo: "/banks/00015.svg", supported: true },
  { code: "00012", name: "Halkbank", short: "Halkbank", initials: "H", color: "#1a5fb4", logo: "/banks/00012.svg", supported: false },
  { code: "00064", name: "İş Bankası", short: "İş Bankası", initials: "İŞ", color: "#2b4a9d", logo: "/banks/00064.svg", supported: false },
  { code: "00062", name: "Garanti BBVA", short: "Garanti", initials: "G", color: "#1d8a4a", logo: "/banks/00062.svg", supported: false },
  { code: "00046", name: "Akbank", short: "Akbank", initials: "A", color: "#e0001b", logo: "/banks/00046.svg", supported: false },
  { code: "00067", name: "Yapı Kredi", short: "Yapı Kredi", initials: "YK", color: "#0a3d91", logo: "/banks/00067.png", supported: false },
  { code: "00111", name: "QNB", short: "QNB", initials: "Q", color: "#6a1b9a", logo: "/banks/00111.svg", supported: false },
  { code: "00134", name: "DenizBank", short: "DenizBank", initials: "D", color: "#0072bc", logo: "/banks/00134.svg", supported: false },
  { code: "00032", name: "TEB", short: "TEB", initials: "T", color: "#2e7d32", logo: "/banks/00032.png", supported: false },
  { code: "00099", name: "ING", short: "ING", initials: "I", color: "#ff6200", logo: "/banks/00099.svg", supported: false },
  { code: "00205", name: "Kuveyt Türk", short: "Kuveyt Türk", initials: "KT", color: "#0b7a3b", logo: "/banks/00205.svg", supported: false },
  { code: "00203", name: "Albaraka Türk", short: "Albaraka", initials: "AB", color: "#3b3b3b", logo: "/banks/00203.svg", supported: false },
  { code: "00206", name: "Türkiye Finans", short: "Türkiye Finans", initials: "TF", color: "#2196f3", logo: "/banks/00206.png", supported: false },
  { code: "00209", name: "Ziraat Katılım", short: "Ziraat Katılım", initials: "ZK", color: "#d0021b", logo: "/banks/00209.svg", supported: false },
  { code: "00210", name: "Vakıf Katılım", short: "Vakıf Katılım", initials: "VK", color: "#f2b800", logo: "/banks/00210.svg", supported: false },
];

/** Drop everything that is not a letter or digit (spaces, non-breaking spaces, dashes, zero-width characters
 *  pasted from banking apps) and uppercase. This is the form that is hashed, sealed and sent to the prover. */
export const normalizeIban = (iban: string) => iban.normalize("NFKC").replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/** `TR` + 24 digits */
export const isTrIbanShape = (iban: string) => /^TR\d{24}$/.test(normalizeIban(iban));

/** ISO 7064 mod 97-10 check digits (catches a mistyped digit). */
export function ibanChecksumOk(iban: string): boolean {
  const s = normalizeIban(iban);
  if (s.length < 5) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** `TR52 0001 5001 5800 7313 4213 85` — groups of four for display and inputs. */
export const formatIban = (iban: string) => normalizeIban(iban).slice(0, 26).replace(/(.{4})/g, "$1 ").trim();

/** The bank a TR IBAN belongs to, from its bank code; `null` for a malformed IBAN or an unlisted bank. */
export function bankFromIban(iban: string): Bank | null {
  const clean = normalizeIban(iban);
  if (!/^TR\d{24}$/.test(clean)) return null;
  const code = clean.slice(4, 9);
  return BANKS.find((b) => b.code === code) ?? null;
}

export const bankByName = (name: string | undefined | null): Bank | null => (name ? (BANKS.find((b) => b.name === name || b.short === name) ?? null) : null);
