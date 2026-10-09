import { stockholmDayOf, stockholmTodayISO } from '@/lib/domains/planning/timezone';

// När ett möte börjar, som det står i påminnelsens push-notis: "idag kl 09:00", "12 okt. kl 14:30".
//
// ⚠️ SVENSK TID, INTE SERVERNS. Notisen byggs i cron-rutten på Vercel, som går på UTC: klockslaget stod
// "kl 07:00" för ett möte kl. 09 (sommartid), och "idag" jämfördes mot UTC-dygnet, så ett möte kl. 00.30
// kallades "idag" kvällen före. William 2026-10-09: svensk tid överallt.

const TIME_ZONE = 'Europe/Stockholm';
const clockFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, day: 'numeric', month: 'short' });

export function formatPushWhen(value: string | null, now: Date = new Date()): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const clock = `kl ${clockFormat.format(date)}`;
  if (stockholmDayOf(value) === stockholmTodayISO(now)) return `idag ${clock}`;
  return `${dayFormat.format(date)} ${clock}`;
}
