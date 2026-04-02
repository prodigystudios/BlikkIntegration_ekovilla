import { adminSupabase } from '@/lib/adminSupabase';
import { getCurrentUser } from '../_util';

export type PublicationRecipientInput = {
  userIds: string[];
  tags: string[];
};

export async function requireAdminUser() {
  const current = await getCurrentUser();
  if (!current || current.role !== 'admin') return null;
  if (!adminSupabase) throw new Error('service_role_missing');
  return current;
}

function normalizeStringList(input: unknown) {
  if (!Array.isArray(input)) return [] as string[];
  return Array.from(new Set(input.map(v => String(v || '').trim()).filter(Boolean)));
}

export function normalizeRecipients(input: any): PublicationRecipientInput {
  return {
    userIds: normalizeStringList(input?.userIds),
    tags: normalizeStringList(input?.tags),
  };
}

export async function resolvePublicationRecipients(input: PublicationRecipientInput) {
  if (!adminSupabase) throw new Error('service_role_missing');

  const directUsers = input.userIds.map(id => ({ id, source_type: 'user' as const, source_value: null as string | null }));
  const tagUsers: Array<{ id: string; source_type: 'tag'; source_value: string }> = [];

  for (const tag of input.tags) {
    const { data, error } = await adminSupabase
      .from('profiles')
      .select('id')
      .contains('tags', [tag]);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      if (!row?.id) continue;
      tagUsers.push({ id: row.id as string, source_type: 'tag', source_value: tag });
    }
  }

  const all = [...directUsers, ...tagUsers];
  const deduped = new Map<string, { userId: string; sourceType: 'user' | 'tag'; sourceValue: string | null }>();
  for (const item of all) {
    if (!deduped.has(item.id)) {
      deduped.set(item.id, {
        userId: item.id,
        sourceType: item.source_type,
        sourceValue: item.source_value,
      });
    }
  }

  return Array.from(deduped.values());
}

export async function getRecipientMeta() {
  if (!adminSupabase) throw new Error('service_role_missing');
  const [{ data: users, error: usersError }, { data: profiles, error: profilesError }] = await Promise.all([
    adminSupabase
      .from('profiles')
      .select('id, full_name, role')
      .order('full_name', { ascending: true }),
    adminSupabase
      .from('profiles')
      .select('tags'),
  ]);

  if (usersError) throw new Error(usersError.message);
  if (profilesError) throw new Error(profilesError.message);

  const tagSet = new Set<string>();
  for (const row of profiles || []) {
    const tags = Array.isArray((row as any)?.tags) ? (row as any).tags : [];
    for (const tag of tags) {
      const normalized = String(tag || '').trim();
      if (normalized) tagSet.add(normalized);
    }
  }

  return {
    users: (users || []).map((row: any) => ({
      id: row.id as string,
      name: row.full_name || 'Okänd användare',
      role: row.role as string,
    })),
    tags: Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'sv')),
  };
}
