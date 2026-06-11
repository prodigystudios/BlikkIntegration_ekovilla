// Fixed planning job types and their card colour. Stored as ops_segments.job_type (free text;
// the app offers this set). `color` is a CSS colour used for the card's job-type dot/chip.

export type JobType = { key: string; label: string; color: string };

export const JOB_TYPES: JobType[] = [
  { key: 'ekovilla', label: 'Ekovilla', color: '#059669' }, // emerald
  { key: 'vitull', label: 'Vitull', color: '#0284c7' }, // sky
  { key: 'leverans', label: 'Leverans', color: '#0d9488' }, // teal
  { key: 'utsugning', label: 'Utsugning', color: '#d97706' }, // amber
  { key: 'snickerier', label: 'Snickerier', color: '#7c3aed' }, // violet
  { key: 'ovrigt', label: 'Övrigt', color: '#64748b' }, // slate
];

const BY_KEY = new Map(JOB_TYPES.map((t) => [t.key, t]));

// Resolve a stored job_type to its label + colour. Empty → null (the caller falls back to the
// material inferred from the work order). An unknown key still renders, in a neutral colour.
export function resolveJobType(jobType: string | null | undefined): JobType | null {
  const key = (jobType ?? '').trim().toLowerCase();
  if (!key) return null;
  return BY_KEY.get(key) ?? { key, label: (jobType ?? '').trim(), color: '#64748b' };
}
