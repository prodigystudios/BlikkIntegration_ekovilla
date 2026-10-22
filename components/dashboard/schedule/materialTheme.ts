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

// Etikettens färger som Tailwind-klasser, inte som inline-stil (FRONTEND_SYSTEM: upprepade färgval
// hör inte hemma i `style`). Samma värden som getMaterialTheme. Klasserna står ordagrant här så att
// Tailwind hittar dem — en sammansatt sträng (`bg-[${hex}]`) hade aldrig genererats.
const PILL_CLASSES = {
  ekovilla: { className: 'bg-[#dcfce7] text-[#166534]', dotClassName: 'bg-[#16a34a]' },
  vitull: { className: 'bg-[#e0f2fe] text-[#075985]', dotClassName: 'bg-[#0284c7]' },
  neutral: { className: 'bg-[#f1f5f9] text-[#334155]', dotClassName: 'bg-[#64748b]' },
} as const;

export type MaterialPill = { label: string; className: string; dotClassName: string };

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
  if (theme.label === 'Ekovilla') return { ...PILL_CLASSES.ekovilla, label: theme.label };
  if (theme.label === 'Vitull') return { ...PILL_CLASSES.vitull, label: theme.label };
  // Okända nycklar (en typ som admin lagt till eller tagit bort) kommer tillbaka som sin råa nyckel,
  // en slug ('takarbete-vind'). Bindestrecken blir mellanslag; å/ä/ö som slugen tog bort går inte att
  // få tillbaka. Startsidan läser inte admins lista (ops_job_types) — planeringstavlan gör det.
  const type = resolveJobTypeFrom(DEFAULT_JOB_TYPES, jobType);
  if (type) {
    const label = type.label.replace(/[-_]+/g, ' ').trim();
    return { ...PILL_CLASSES.neutral, label: label.charAt(0).toUpperCase() + label.slice(1) };
  }
  return { ...PILL_CLASSES.neutral, label: 'Material ej angivet' };
}
