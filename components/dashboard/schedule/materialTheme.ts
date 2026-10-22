import { DEFAULT_JOB_TYPES, resolveJobTypeFrom } from '@/lib/domains/planning/jobTypes';

// Materialets färger i arbetsschemat. Delas av stoppkortet och den äldre detaljmodalen, som båda
// läser radens `job_type` — ett fritt textfält i den gamla planeringen, en nyckel ('ekovilla',
// 'leverans', …) i CRM-planeringen. Prefixmatchningen klarar båda.

export type MaterialTheme = { accent: string; badgeBg: string; badgeFg: string; label: string | null };

export function getMaterialTheme(jobType?: string | null): MaterialTheme {
  const jt = (jobType || '').toLowerCase();
  if (jt.startsWith('eko')) return { accent: '#16a34a', badgeBg: '#dcfce7', badgeFg: '#166534', label: 'Ekovilla' };
  if (jt.startsWith('vit')) return { accent: '#0284c7', badgeBg: '#e0f2fe', badgeFg: '#075985', label: 'Vitull' };
  return { accent: '#64748b', badgeBg: '#f1f5f9', badgeFg: '#334155', label: null };
}

export type MaterialPill = { label: string; fg: string; bg: string; dot: string };

/**
 * Etiketten på stoppkortets metarad.
 *
 * Tre fall, och de får inte flyta ihop:
 * - Ekovilla/Vitull: materialets färger.
 * - En jobbtyp som inte är ett material (Leverans, Utsugning, …): typens namn i neutralt. "Material
 *   ej angivet" hade varit fel — planeraren HAR angett vad jobbet är, bara inte ett isoleringsmaterial.
 * - Ingen typ alls: "Material ej angivet". Det gamla kortet ritade då en grå prick och en grå kant
 *   som inte betydde något; nu står det i klartext.
 *
 * ⚠️ En CRM-placering utan egen jobbtyp hamnar i det tredje fallet även när arbetsordern har
 * Ekovilla på raderna: feeden (get_my_crm_jobs) bär inte orderns material. Planeringstavlan härleder
 * det ur raderna; startsidan får det först när feeden gör det (fas 3 i ARBETSSCHEMA_KORT_REDESIGN_PLAN).
 */
export function materialPill(jobType?: string | null): MaterialPill {
  const theme = getMaterialTheme(jobType);
  const base = { fg: theme.badgeFg, bg: theme.badgeBg, dot: theme.accent };
  if (theme.label) return { ...base, label: theme.label };
  // Okända nycklar (en typ som admin lagt till eller tagit bort) kommer tillbaka som sin råa nyckel.
  const type = resolveJobTypeFrom(DEFAULT_JOB_TYPES, jobType);
  if (type) return { ...base, label: type.label.charAt(0).toUpperCase() + type.label.slice(1) };
  return { ...base, label: 'Material ej angivet' };
}
