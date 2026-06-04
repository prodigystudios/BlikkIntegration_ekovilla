import type { SupabaseClient } from '@supabase/supabase-js';

export const SWEDISH_COUNTIES = [
  'Blekinge',
  'Dalarna',
  'Gävleborg',
  'Gotland',
  'Halland',
  'Jämtland',
  'Jönköping',
  'Kalmar',
  'Kronoberg',
  'Norrbotten',
  'Skåne',
  'Stockholm',
  'Södermanland',
  'Uppsala',
  'Värmland',
  'Västerbotten',
  'Västernorrland',
  'Västmanland',
  'Västra Götaland',
  'Örebro',
  'Östergötland',
] as const;

export type SwedishCounty = typeof SWEDISH_COUNTIES[number];

const routingRuleSelect = `
  id,
  county,
  user_id,
  priority,
  created_by,
  created_at
`;

export type RoutingRule = {
  id: string;
  county: string;
  user_id: string;
  priority: number;
  created_by: string;
  created_at: string;
};

export type UpsertRoutingRuleInput = {
  county: string;
  user_id: string;
  created_by: string;
  priority?: number;
};

export async function listRoutingRules(supabase: SupabaseClient) {
  return supabase
    .from('crm_routing_rules')
    .select(routingRuleSelect)
    .order('county', { ascending: true });
}

export async function upsertRoutingRule(supabase: SupabaseClient, input: UpsertRoutingRuleInput) {
  return supabase
    .from('crm_routing_rules')
    .upsert(
      {
        county: input.county,
        user_id: input.user_id,
        priority: input.priority ?? 0,
        created_by: input.created_by,
      },
      { onConflict: 'county' }
    )
    .select(routingRuleSelect)
    .single();
}

export async function deleteRoutingRule(supabase: SupabaseClient, id: string) {
  return supabase.from('crm_routing_rules').delete().eq('id', id);
}

export async function resolveRoutingUser(supabase: SupabaseClient, county: string): Promise<string | null> {
  const { data } = await supabase
    .from('crm_routing_rules')
    .select('user_id')
    .eq('county', county)
    .order('priority', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.user_id ?? null;
}
