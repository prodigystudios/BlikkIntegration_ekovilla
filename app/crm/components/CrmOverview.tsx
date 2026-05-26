import Link from 'next/link';
import SectionCard from '../../../components/ui/SectionCard';
import type { UserRole } from '@/lib/roles';
import { getVisibleCrmNavItems } from '../_lib/nav';

export default function CrmOverview({ role }: { role: UserRole | null }) {
  const items = getVisibleCrmNavItems(role).filter((item) => item.href !== '/crm');

  return (
    <div className="grid gap-4">
      <SectionCard className="grid gap-3 p-5 md:p-6">
        <div className="grid gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">CRM</span>
          <h1 className="m-0 text-2xl font-bold tracking-[-0.03em] text-slate-900 md:text-3xl">Säljytan är upplagd</h1>
          <p className="m-0 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">
            Det här är första skelettet för CRM-delen. Härifrån kan vi nu bygga prospects, samtalsloggning,
            uppföljningar, offerter och senare Fortnox- samt planeringskopplingar utan att blanda ihop dem med resten av appen.
          </p>
        </div>
        <div className="grid gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-emerald-900 md:grid-cols-3">
          <div className="grid gap-1">
            <strong className="font-semibold">Fas 1</strong>
            <span>Prospects, samtal, uppgifter och enkel översikt.</span>
          </div>
          <div className="grid gap-1">
            <strong className="font-semibold">Nästa lager</strong>
            <span>Ringlistor, import, mål och offertflöden.</span>
          </div>
          <div className="grid gap-1">
            <strong className="font-semibold">Senare</strong>
            <span>Fortnox, AI-flöden och planeringssynk.</span>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="no-underline">
            <SectionCard className="grid h-full gap-2 rounded-[24px] border-slate-200 p-5 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_16px_34px_rgba(16,185,129,0.12)]">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">CRM-sektion</span>
              <strong className="text-lg font-bold tracking-[-0.02em] text-slate-900">{item.label}</strong>
              <p className="m-0 text-sm leading-6 text-slate-600">{item.description}</p>
              <span className="text-sm font-semibold text-emerald-700">Öppna</span>
            </SectionCard>
          </Link>
        ))}
      </div>
    </div>
  );
}