export type { CurrentUser } from '@/lib/auth/route';
export { getCurrentUser } from '@/lib/auth/route';

export function getDocsBucket() {
  return process.env.SUPABASE_DOCS_BUCKET || process.env.SUPABASE_BUCKET || 'pdfs';
}

export function sanitizeFolderName(name: string) {
  const trimmed = String(name || '').trim();
  const cleaned = trimmed
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+\./g, '.')
    .replace(/[^\w\s.-]+/g, '_')
    .trim();
  return cleaned;
}

export type FolderColor = 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'purple';

export function sanitizeFolderColor(input: any): FolderColor | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const v = raw.toLowerCase();

  // Swedish + English inputs
  const map: Record<string, FolderColor> = {
    gray: 'gray',
    grey: 'gray',
    grå: 'gray',
    gra: 'gray',

    blue: 'blue',
    blå: 'blue',
    bla: 'blue',

    green: 'green',
    grön: 'green',
    gron: 'green',

    yellow: 'yellow',
    gul: 'yellow',

    red: 'red',
    röd: 'red',
    rod: 'red',

    purple: 'purple',
    lila: 'purple',
    violet: 'purple',
  };

  return map[v] ?? null;
}

export function sanitizeFileName(name: string) {
  const base = String(name || '').trim();
  const cleaned = base
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+\./g, '.')
    .replace(/[^\w\s.-]+/g, '_')
    .trim();
  // Prevent empty/hidden-only names
  return cleaned || 'file';
}
