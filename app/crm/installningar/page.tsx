import { redirect } from 'next/navigation';
import { getUserProfile } from '@/lib/getUserProfile';
import { getCurrentWeekStartDate, mapCrmGoalRows } from '@/lib/crm/goals';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import CrmSettingsView from './CrmSettingsView';

export const dynamic = 'force-dynamic';

export default async function CrmSettingsPage() {
  const profile = await getUserProfile();
  if (profile?.role !== 'admin') redirect('/crm');

  const supabase = getSupabaseAdmin();
  const currentWeekStart = getCurrentWeekStartDate();

  const [teamRes, goalsRes, unassignedProspectsRes, openTasksRes, quoteFollowUpsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, phone, role')
      .in('role', ['sales', 'admin', 'konsult']),
    supabase
      .from('crm_goals')
      .select('id, user_id, period_type, period_start, calls_target, quotes_target, quote_value_target, created_by, updated_by, created_at, updated_at, user:profiles!crm_goals_user_id_fkey(id, full_name, role)')
      .eq('period_type', 'week')
      .eq('period_start', currentWeekStart),
    supabase
      .from('crm_prospects')
      .select('id', { count: 'exact', head: true })
      .is('assigned_to', null),
    supabase
      .from('dashboard_work_items')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'note')
      .eq('status', 'active'),
    supabase
      .from('crm_quotes')
      .select('id', { count: 'exact', head: true })
      .in('status', ['sent', 'follow_up']),
  ]);

  const crmTeam = (teamRes.data || [])
    .filter((item): item is { id: string; full_name: string | null; phone: string | null; role: 'sales' | 'admin' | 'konsult' } => (
      item.role === 'sales' || item.role === 'admin' || item.role === 'konsult'
    ))
    .sort((left, right) => {
      const roleOrder = { admin: 0, sales: 1, konsult: 2 } as const;
      const roleDiff = roleOrder[left.role] - roleOrder[right.role];
      if (roleDiff !== 0) return roleDiff;
      return (left.full_name || '').localeCompare(right.full_name || '', 'sv');
    });

  const goalTeam = crmTeam.filter((member): member is { id: string; full_name: string | null; phone: string | null; role: 'sales' | 'admin' } => (
    member.role === 'sales' || member.role === 'admin'
  ));
  const currentGoals = mapCrmGoalRows(goalsRes.data as any[] | null | undefined);

  const adminCount = crmTeam.filter((member) => member.role === 'admin').length;

  const stats = [
    {
      label: 'CRM-profiler',
      value: crmTeam.length,
      tone: 'neutral' as const,
      helper: 'Alla profiler som idag kan bära CRM-flöden eller administrera dem.',
    },
    {
      label: 'Admins',
      value: adminCount,
      tone: 'sky' as const,
      helper: 'Behöver vara tillräckligt många för att kunna städa köer och ägarskap.',
    },
    {
      label: 'Oallokerade leads',
      value: unassignedProspectsRes.count ?? null,
      tone: 'amber' as const,
      helper: 'Direkt indikator på hur mycket som fortfarande ligger kvar i ringkön.',
    },
    {
      label: 'Öppna uppgifter',
      value: openTasksRes.count ?? null,
      tone: 'emerald' as const,
      helper: 'Visar om teamet lämnar mycket uppföljning efter sig i arbetsflödet.',
    },
  ];

  const integrations = [
    {
      name: 'Blikk-koppling',
      status: process.env.BLIKK_APP_ID && process.env.BLIKK_APP_SECRET ? 'ready' as const : 'attention' as const,
      description: process.env.BLIKK_APP_ID && process.env.BLIKK_APP_SECRET
        ? 'Grundläggande appnycklar finns. Nästa kritiska del är att hålla användarmappningen korrekt.'
        : 'Appnycklar saknas eller är inte satta i miljön. Den kopplingen bör vara på plats innan CRM integreras djupare.',
      href: '/admin?tab=blikk',
      hrefLabel: 'Öppna Blikk-mappning',
    },
    {
      name: 'CRM offertuppföljning',
      status: (quoteFollowUpsRes.count ?? 0) > 0 ? 'attention' as const : 'ready' as const,
      description: (quoteFollowUpsRes.count ?? 0) > 0
        ? `${quoteFollowUpsRes.count ?? 0} offerter ligger i skickad eller följ upp och behöver aktiv hantering.`
        : 'Inga offerter ligger just nu och väntar på uppföljning i CRM-flödet.',
      href: '/crm/offerter',
      hrefLabel: 'Öppna offerter',
    },
    {
      name: 'Ringkö och ägarskap',
      status: (unassignedProspectsRes.count ?? 0) > 0 ? 'attention' as const : 'ready' as const,
      description: (unassignedProspectsRes.count ?? 0) > 0
        ? 'Det finns leads utan ägare. Gå till ringlistor om kön ska hållas tajt.'
        : 'Alla prospekt har en ägare just nu, så ringkön är inte blockerad av obemannade leads.',
      href: '/crm/ringlistor',
      hrefLabel: 'Öppna ringlistor',
    },
  ];

  return (
    <CrmSettingsView
      team={crmTeam}
      goalTeam={goalTeam}
      goals={currentGoals}
      goalPeriodStart={currentWeekStart}
      stats={stats}
      integrations={integrations}
    />
  );
}