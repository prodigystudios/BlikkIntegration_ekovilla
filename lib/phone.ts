// Normalise a Swedish phone number to E.164 (+46…) for Twilio, which rejects national formats like
// "0701234567" or "070-123 45 67". Returns null when the input can't be made into a plausible E.164
// number. Swedish-first (this is a Swedish business); an already-international "+…" number is kept.
export function toSwedishE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\-().]/g, '').trim();
  if (!cleaned) return null;

  let s: string;
  if (cleaned.startsWith('+')) s = cleaned; // already international
  else if (cleaned.startsWith('00')) s = `+${cleaned.slice(2)}`; // 00-prefixed international
  else if (cleaned.startsWith('0')) s = `+46${cleaned.slice(1)}`; // national: 0701… → +46701…
  else if (cleaned.startsWith('46')) s = `+${cleaned}`; // 46701… → +46701…
  else if (/^\d+$/.test(cleaned)) s = `+46${cleaned}`; // bare national digits, missing the leading 0
  else return null;

  return /^\+\d{8,15}$/.test(s) ? s : null;
}
