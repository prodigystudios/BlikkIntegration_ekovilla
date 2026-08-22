/**
 * Relativ ålder på svenska: "nyss", "3 dagar sedan", "2 mån sedan".
 *
 * Låg här i `lib/useProjectComments.ts` och användes bara av kommentarslistorna. CRM-översikten
 * behövde samma sak för "Senaste samtal", och alternativet hade varit en tredje variant i repot —
 * `app/plannering/page.tsx:3993` har redan en egen halv. Flyttad hit i stället; useProjectComments
 * re-exporterar den, så dess tre konsumenter (en av dem i den skyddade planeringsytan) är orörda.
 *
 * `now` är injicerbar för testernas skull. Utan den är funktionen omöjlig att testa deterministiskt.
 */
export function formatRelativeTime(dateStr: string | null, now: number = Date.now()): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.slice(0, 16).replace('T', ' ');
  const diffMs = now - d.getTime();
  if (diffMs < 0) return 'nyss';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return 'nyss';
  const min = Math.floor(sec / 60);
  if (min < 2) return '1 min sedan';
  if (min < 60) return `${min} min sedan`;
  const hrs = Math.floor(min / 60);
  if (hrs < 2) return '1 h sedan';
  if (hrs < 24) return `${hrs} h sedan`;
  const days = Math.floor(hrs / 24);
  if (days < 2) return '1 dag sedan';
  if (days < 7) return `${days} dagar sedan`;
  const weeks = Math.floor(days / 7);
  if (weeks < 2) return '1 v sedan';
  if (weeks < 5) return `${weeks} v sedan`;
  const months = Math.floor(days / 30);
  if (months < 2) return '1 mån sedan';
  if (months < 12) return `${months} mån sedan`;
  const years = Math.floor(days / 365);
  if (years < 2) return '1 år sedan';
  return `${years} år sedan`;
}

/**
 * Hela dygn sedan `dateStr`. `null` för saknat, ogiltigt eller framtida datum.
 *
 * ⚠️ Räknas på ren varaktighet (ms / 86 400 000), inte kalenderdygn — över en sommartidsgräns är
 * ett dygn 23 eller 25 timmar, så siffran kan ligga ett dygn fel mot en kalenderräkning. Det är
 * med flit: det här är en tröskel för en påminnelse ("ingen har loggat på 9 dagar"), inte ett tal
 * någon räknar med. Behöver något kalenderdygn ska det INTE använda den här.
 */
export function daysSince(dateStr: string | null | undefined, now: number = Date.now()): number | null {
  if (!dateStr) return null;
  const time = new Date(dateStr).getTime();
  if (!Number.isFinite(time)) return null;
  const diffMs = now - time;
  if (diffMs < 0) return null;
  return Math.floor(diffMs / 86_400_000);
}
