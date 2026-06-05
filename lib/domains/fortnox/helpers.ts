import { getSupabaseAdmin } from '@/lib/supabase/server';

// Looks up the assigned user's full name for use as OurReference in Fortnox documents.
export async function resolveOurReference(
  userId: string | null,
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<string | undefined> {
  if (!userId) return undefined;
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();
  return (data as { full_name?: string | null } | null)?.full_name ?? undefined;
}
