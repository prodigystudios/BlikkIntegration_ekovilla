import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export type CurrentUser = { id: string; role: 'member' | 'sales' | 'admin' | 'konsult'; name?: string | null };

export function getDocsBucket() {
  return process.env.SUPABASE_DOCS_BUCKET || process.env.SUPABASE_BUCKET || 'pdfs';
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: prof } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle();
  const role = (prof as any)?.role as CurrentUser['role'] | undefined;
  return {
    id: user.id,
    role: role || 'member',
    name: (prof as any)?.full_name ?? null,
  };
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
