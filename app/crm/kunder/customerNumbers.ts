// Shared helpers for the Swedish org/personal/VAT number fields used by both the
// create form (CustomerFormClient) and the edit view (CustomerDetailClient).

// Luhn (mod 10) check over a 10-digit Swedish org/personal number. The last digit
// is a check digit computed from the first nine, so a random number won't validate.
function luhn10Valid(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = digits.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Mask Swedish org/personal numbers as ######-#### while typing: keep digits only
// (capped at 10) and auto-insert the hyphen once the user reaches the last 4.
export function formatSwedishIdNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

// True when the value is a complete, checksum-valid Swedish org number. Used to
// gate VAT derivation and to warn before an invalid number reaches Fortnox.
export function isValidSwedishOrgNumber(value: string): boolean {
  return luhn10Valid(value.replace(/\D/g, ''));
}

// Swedish VAT numbers are deterministic: SE + the 10-digit org number + 01.
// Returns null unless the org number is a complete, checksum-valid one, so a
// random/incomplete number never produces a VAT that Fortnox would reject.
export function vatFromOrgNumber(orgNumber: string): string | null {
  const digits = orgNumber.replace(/\D/g, '');
  if (!luhn10Valid(digits)) return null;
  return `SE${digits}01`;
}
