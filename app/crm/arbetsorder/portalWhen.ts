// Tiderna i kortet "Butiken" (meddelandena och dokumenten): "08:14" i dag, "12 okt. 08:14" i år, annars med året.
// Svensk tid, som resten av CRM:et.

const stockholmDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' });
const stockholmTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });
const stockholmDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'short' });
const stockholmDateYear = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'short', year: 'numeric' });

export function portalWhen(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = stockholmTime.format(at);
  if (stockholmDay.format(at) === stockholmDay.format(now)) return time;
  const sameYear = stockholmDay.format(at).slice(0, 4) === stockholmDay.format(now).slice(0, 4);
  return `${(sameYear ? stockholmDate : stockholmDateYear).format(at)} ${time}`;
}

/** "i dag 08:14" eller "12 okt. 08:14", för en mening. */
export function portalWhenInSentence(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const text = portalWhen(iso, now);
  return stockholmDay.format(at) === stockholmDay.format(now) ? `i dag ${text}` : text;
}
