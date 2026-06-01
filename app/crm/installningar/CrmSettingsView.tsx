import Link from 'next/link';
import CrmGoalsPanel from './CrmGoalsPanel';

type CrmTeamMember = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: 'sales' | 'admin' | 'konsult';
};

type SettingsStat = {
  label: string;
  value: number | null;
  tone: 'neutral' | 'sky' | 'emerald' | 'amber';
  helper: string;
};

type IntegrationItem = {
  name: string;
  status: 'ready' | 'attention';
  description: string;
  href?: string;
  hrefLabel?: string;
};

type GoalItem = {
  user_id: string;
  calls_target: number;
  quotes_target: number;
  quote_value_target: number | string;
};

const roleClass: Record<CrmTeamMember['role'], string> = {
  admin: 'border-rose-200 bg-rose-50 text-rose-700',
  sales: 'border-sky-200 bg-sky-50 text-sky-700',
  konsult: 'border-amber-200 bg-amber-50 text-amber-800',
};

const roleLabel: Record<CrmTeamMember['role'], string> = {
  admin: 'Admin',
  sales: 'Sälj',
  konsult: 'Konsult',
};

const integrationClass: Record<IntegrationItem['status'], string> = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  attention: 'border-amber-200 bg-amber-50 text-amber-800',
};

export default function CrmSettingsView({
  team,
  goalTeam,
  goals,
  goalPeriodStart,
  stats,
  integrations,
}: {
  team: CrmTeamMember[];
  goalTeam: Array<{ id: string; full_name: string | null; role: 'sales' | 'admin' }>;
  goals: GoalItem[];
  goalPeriodStart: string;
  stats: SettingsStat[];
  integrations: IntegrationItem[];
}) {
  return (
    <div className="grid gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Inställningar</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">Hantera dina CRM-inställningar, mål och team</p>
        </div>
        <span className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
          Endast admin
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">{item.label}</div>
            <div className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{item.value ?? '–'}</div>
            <div className="mt-0.5 text-sm text-slate-500">{item.helper}</div>
          </div>
        ))}
      </div>

      {/* Goals */}
      <CrmGoalsPanel team={goalTeam} initialGoals={goals} periodStart={goalPeriodStart} />

      {/* Team + Integrations */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.9fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
          <h2 className="m-0 mb-1 text-base font-bold text-slate-900">Team och roller</h2>
          <p className="m-0 mb-4 text-sm text-slate-500">Profiler som kan bära CRM-flöden, ta leads eller administrera arbetsytan.</p>

          {team.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
              Inga CRM-profiler hittades ännu.
            </div>
          ) : (
            <div className="grid gap-2">
              {team.map((member) => (
                <div key={member.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-4 py-3">
                  <div>
                    <strong className="block text-sm font-semibold text-slate-900">{member.full_name || 'Namn saknas'}</strong>
                    <span className="text-xs text-slate-500">{member.phone || 'Telefon saknas'}</span>
                  </div>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${roleClass[member.role]}`}>
                    {roleLabel[member.role]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-4">
          {/* Quick links */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <h2 className="m-0 mb-4 text-base font-bold text-slate-900">Operativa genvägar</h2>
            <div className="grid gap-2">
              {[
                { href: '/crm/ringlistor', title: 'Ringlistor', description: 'Importera leads och håll kön ren.' },
                { href: '/crm/prospekt', title: 'Prospekt', description: 'Granska den bredare pipen.' },
                { href: '/admin?tab=blikk', title: 'Blikk-koppling', description: 'Matcha profiler mot rätt Blikk-användare.' },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 p-3 no-underline transition hover:border-slate-200 hover:bg-slate-50"
                >
                  <div>
                    <strong className="block text-sm font-semibold text-slate-900">{item.title}</strong>
                    <span className="text-xs text-slate-500">{item.description}</span>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-emerald-700">→</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Integrations */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <h2 className="m-0 mb-4 text-base font-bold text-slate-900">Integrationsberedskap</h2>
            <div className="grid gap-2">
              {integrations.map((item) => (
                <div key={item.name} className="rounded-xl border border-slate-100 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <strong className="text-sm font-semibold text-slate-900">{item.name}</strong>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${integrationClass[item.status]}`}>
                      {item.status === 'ready' ? 'Redo' : 'Behöver tillsyn'}
                    </span>
                  </div>
                  <p className="m-0 text-xs leading-5 text-slate-500">{item.description}</p>
                  {item.href && item.hrefLabel ? (
                    <Link href={item.href} className="mt-1 block text-xs font-semibold text-emerald-700 no-underline">
                      {item.hrefLabel}
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
