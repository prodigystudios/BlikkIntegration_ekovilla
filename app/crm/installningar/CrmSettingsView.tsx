import Link from 'next/link';
import CrmGoalsPanel from './CrmGoalsPanel';
import SectionCard from '../../../components/ui/SectionCard';

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

const statToneClass: Record<SettingsStat['tone'], string> = {
  neutral: 'border-slate-200 bg-white text-slate-900',
  sky: 'border-sky-200 bg-sky-50/80 text-sky-950',
  emerald: 'border-emerald-200 bg-emerald-50/80 text-emerald-950',
  amber: 'border-amber-200 bg-amber-50/80 text-amber-950',
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
    <div className="grid gap-3 md:gap-4">
      <SectionCard className="overflow-hidden border-emerald-300/80 bg-[radial-gradient(circle_at_top_left,_rgba(22,163,74,0.22),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(101,163,13,0.16),_transparent_24%),linear-gradient(135deg,#f6fbf4_0%,#e5f4e8_56%,#f5fbf6_100%)] p-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:p-5 xl:p-6">
        <div className="grid gap-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="grid gap-3">
              <div className="inline-flex w-fit items-center rounded-full border border-emerald-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-900 shadow-[0_8px_18px_rgba(255,255,255,0.35)]">
                CRM / Inställningar
              </div>
              <div className="grid gap-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="m-0 text-[clamp(1.75rem,3vw,2.8rem)] font-bold tracking-[-0.05em] text-slate-950">CRM-kontrollrum</h1>
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">Endast admin</div>
                </div>
                <p className="m-0 max-w-3xl text-sm text-slate-600">
                  Här samlar du det som faktiskt styr CRM-arbetet just nu: vilka som kan ta leads, hur stor den oallokerade kön är och om de viktigaste kopplingarna är redo inför nästa utbyggnad.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <div className="rounded-full border border-white/70 bg-white/85 px-3 py-2 text-sm font-semibold text-slate-700 shadow-[0_10px_18px_rgba(15,23,42,0.04)]">
                Adminstyrning
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            {stats.map((item) => (
              <div key={item.label} className={`rounded-[18px] border p-3 shadow-[0_16px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/80 ${statToneClass[item.tone]}`}>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{item.label}</div>
                <div className="mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-bold tracking-[-0.04em] text-slate-950">{item.value ?? '–'}</div>
                <div className="mt-1 text-[13px] text-slate-500">{item.helper}</div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
        <SectionCard className="grid gap-3 border-emerald-200/65 bg-[linear-gradient(180deg,rgba(250,253,250,0.98),rgba(244,249,245,0.98))] p-4 shadow-[0_18px_38px_rgba(15,23,42,0.06)] md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-1">
              <strong className="text-base font-bold text-slate-950">Nyckeltal</strong>
              <p className="m-0 text-sm leading-6 text-slate-600">Snabb lägesbild av bemanning, kötryck och aktivitet i CRM-arbetet.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {stats.map((item) => (
              <div key={item.label} className={`grid gap-1 rounded-[22px] border px-4 py-4 shadow-[0_12px_24px_rgba(15,23,42,0.05)] ${statToneClass[item.tone]}`}>
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</span>
                <strong className="text-2xl font-bold tracking-[-0.05em]">{item.value ?? '–'}</strong>
                <span className="text-sm leading-6 text-slate-600">{item.helper}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard className="grid gap-3 border-emerald-200/65 bg-[linear-gradient(180deg,rgba(250,253,250,0.98),rgba(244,249,245,0.98))] p-4 shadow-[0_18px_38px_rgba(15,23,42,0.06)] md:p-5">
          <div className="grid gap-1">
            <strong className="text-base font-bold text-slate-950">Operativa genvägar</strong>
            <p className="m-0 text-sm leading-6 text-slate-600">Hoppa direkt till de ytor som faktiskt påverkar bemanning, leadflöde och integrationer.</p>
          </div>

          <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            {[
              {
                href: '/crm/ringlistor',
                title: 'Ringlistor',
                description: 'Importera leads, sätt ägare och håll den oallokerade kön ren.',
              },
              {
                href: '/crm/prospekt',
                title: 'Prospekt',
                description: 'Granska den bredare pipen när något lämnat ringkön och blivit aktivt säljarbete.',
              },
              {
                href: '/admin?tab=blikk',
                title: 'Blikk-koppling',
                description: 'Matcha profiler mot rätt Blikk-användare så senare integrationer inte spårar ur.',
              },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="grid gap-1 rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 text-left no-underline shadow-[0_12px_24px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_32px_rgba(15,23,42,0.08)]"
              >
                <strong className="text-sm font-semibold text-slate-950">{item.title}</strong>
                <span className="text-sm leading-6 text-slate-600">{item.description}</span>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>

      <CrmGoalsPanel team={goalTeam} initialGoals={goals} periodStart={goalPeriodStart} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.9fr)]">
        <SectionCard className="grid gap-3 border-emerald-200/65 bg-[linear-gradient(180deg,rgba(250,253,250,0.98),rgba(244,249,245,0.98))] p-4 shadow-[0_18px_38px_rgba(15,23,42,0.06)] md:p-5">
          <div className="grid gap-1">
            <strong className="text-base font-bold text-slate-950">Team och roller</strong>
            <p className="m-0 text-sm leading-6 text-slate-600">De här profilerna kan idag bära CRM-flöden, ta leads eller administrera arbetsytan.</p>
          </div>

          {team.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-600">
              Inga CRM-profiler hittades ännu.
            </div>
          ) : (
            <div className="grid gap-3">
              {team.map((member) => (
                <div key={member.id} className="grid gap-2 rounded-[20px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.96)_100%)] px-4 py-3.5 shadow-[0_12px_24px_rgba(15,23,42,0.05)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="grid gap-1">
                    <strong className="text-base font-bold tracking-[-0.03em] text-slate-950">{member.full_name || 'Namn saknas'}</strong>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span>Roll: {roleLabel[member.role]}</span>
                      <span>{member.phone ? `Telefon: ${member.phone}` : 'Telefon saknas'}</span>
                    </div>
                  </div>
                  <span className={`w-fit rounded-full border px-3 py-1.5 text-xs font-semibold ${roleClass[member.role]}`}>
                    {roleLabel[member.role]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard className="grid gap-3 border-emerald-200/65 bg-[linear-gradient(180deg,rgba(250,253,250,0.98),rgba(244,249,245,0.98))] p-4 shadow-[0_18px_38px_rgba(15,23,42,0.06)] md:p-5">
          <div className="grid gap-1">
            <strong className="text-base font-bold text-slate-950">Integrationsberedskap</strong>
            <p className="m-0 text-sm leading-6 text-slate-600">En snabb signal om vad som redan är kopplat och vad som fortfarande kräver adminarbete.</p>
          </div>

          <div className="grid gap-3">
            {integrations.map((item) => (
              <div key={item.name} className="grid gap-2 rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm font-semibold text-slate-950">{item.name}</strong>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${integrationClass[item.status]}`}>
                    {item.status === 'ready' ? 'Redo' : 'Behöver tillsyn'}
                  </span>
                </div>
                <p className="m-0 text-sm leading-6 text-slate-600">{item.description}</p>
                {item.href && item.hrefLabel ? (
                  <Link href={item.href} className="text-sm font-semibold text-emerald-700 no-underline hover:text-emerald-800">
                    {item.hrefLabel}
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}