//! Payee binding that works with Ziraat's masked dekonts.
//!
//! An outgoing FAST dekont prints the recipient IBAN masked (`TR37 **** **** **** **** 0000 01`),
//! the recipient bank (`0205 - Kuveyt Türk …`) and the recipient name. The escrow knows the seller's
//! full IBAN and name. Both sides therefore hash the same visible facts:
//!
//! `payee_hash = sha256("zkotc/payee/v1" ‖ prefix4 ‖ bank5 ‖ last6 ‖ folded_name)`
//!
//! * `prefix4` — `TR` + 2 check digits (IBAN chars 0..4)
//! * `bank5`   — 5-digit Turkish bank code (IBAN chars 4..9; the dekont prints it as `0205` → `00205`)
//! * `last6`   — last 6 IBAN digits
//! * `folded_name` — uppercase, Turkish letters folded to ASCII (Ç→C Ğ→G İ/ı→I Ö→O Ş→S Ü→U), single spaces
//!
//! The Soroban escrow implements the identical preimage in `contracts/escrow`.

use sha2::{Digest, Sha256};

pub const PAYEE_DOMAIN: &[u8] = b"zkotc/payee/v1";

/// Uppercase + Turkish-to-ASCII folding + whitespace normalization (must match the contract).
pub fn fold_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut pending_space = false;
    for c in name.chars() {
        let mapped: Option<char> = match c {
            'ç' | 'Ç' => Some('C'),
            'ğ' | 'Ğ' => Some('G'),
            'ı' | 'İ' | 'i' | 'I' => Some('I'),
            'ö' | 'Ö' => Some('O'),
            'ş' | 'Ş' => Some('S'),
            'ü' | 'Ü' => Some('U'),
            c if c.is_whitespace() => None,
            c => Some(c.to_ascii_uppercase()),
        };
        match mapped {
            None => pending_space = !out.is_empty(),
            Some(m) => {
                if pending_space {
                    out.push(' ');
                    pending_space = false;
                }
                out.push(m);
            }
        }
    }
    out
}

/// Hash from the parts as they appear on a dekont: masked IBAN (spaces optional), bank code
/// (`0205` or `00205`), recipient name.
pub fn payee_hash_from_dekont(masked_iban: &str, bank_code: &str, name: &str) -> Option<[u8; 32]> {
    let iban: String = masked_iban.chars().filter(|c| !c.is_whitespace()).map(|c| c.to_ascii_uppercase()).collect();
    if iban.len() != 26 || !iban.starts_with("TR") {
        return None;
    }
    let digits: String = bank_code.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() || digits.len() > 5 {
        return None;
    }
    let bank5 = format!("{digits:0>5}");
    let prefix4 = &iban[..4];
    let last6 = &iban[20..];
    if !prefix4[2..].chars().all(|c| c.is_ascii_digit()) || !last6.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(hash(prefix4, &bank5, last6, &fold_name(name)))
}

/// Hash from the seller's full IBAN (`TR` + 24 digits, spaces optional) and name.
pub fn payee_hash_from_full(iban: &str, name: &str) -> Option<[u8; 32]> {
    let iban: String = iban.chars().filter(|c| !c.is_whitespace()).map(|c| c.to_ascii_uppercase()).collect();
    if iban.len() != 26 || !iban.starts_with("TR") || !iban[2..].chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(hash(&iban[..4], &iban[4..9], &iban[20..], &fold_name(name)))
}

fn hash(prefix4: &str, bank5: &str, last6: &str, folded_name: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(PAYEE_DOMAIN);
    h.update(prefix4.as_bytes());
    h.update(bank5.as_bytes());
    h.update(last6.as_bytes());
    h.update(folded_name.as_bytes());
    h.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folding() {
        assert_eq!(fold_name("Feyyaz Numan Çavlak"), "FEYYAZ NUMAN CAVLAK");
        assert_eq!(fold_name("  ayşe   yılmaz "), "AYSE YILMAZ");
        assert_eq!(fold_name("İbrahim Öztürk"), "IBRAHIM OZTURK");
    }

    #[test]
    fn masked_and_full_agree() {
        let full = payee_hash_from_full("TR37 0020 5000 0940 3049 0000 01", "Feyyaz Numan Çavlak").unwrap();
        let masked = payee_hash_from_dekont("TR37 **** **** **** **** 0000 01", "0205", "FEYYAZ NUMAN CAVLAK").unwrap();
        assert_eq!(full, masked);
        // different bank, name or tail → different hash
        assert_ne!(full, payee_hash_from_dekont("TR37 **** **** **** **** 0000 01", "0010", "FEYYAZ NUMAN CAVLAK").unwrap());
        assert_ne!(full, payee_hash_from_dekont("TR37 **** **** **** **** 0000 01", "0205", "AHMET DEMIR").unwrap());
        assert_ne!(full, payee_hash_from_dekont("TR37 **** **** **** **** 0000 02", "0205", "FEYYAZ NUMAN CAVLAK").unwrap());
        assert!(payee_hash_from_dekont("TR37 ****", "0205", "X").is_none());
    }
}
