import type { ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';

type MetricCardProps = {
  label: string;
  value: number | string;
  helper?: string;
  icon?: ReactNode;
  iconBg?: string;
  trend?: { value: number; label?: string };
  className?: string;
};

// Minimal CRM KPI card: label kicker + prominent value, nothing else.
// The label already says what the number means, so no helper line — kept as
// low-profile as possible so a row of four reads as a quick summary band.
// `helper` stays in the props for call-site compatibility but is not rendered.
export default function MetricCard({ label, value, icon, iconBg = 'bg-emerald-100', trend, className }: MetricCardProps) {
  const trendUp = trend != null && trend.value >= 0;

  return (
    <div
      className={cn(
        'rounded-xl border border-[#e3e9df] bg-[#f9fbf7] px-3.5 py-2.5 shadow-[0_1px_2px_rgba(20,44,27,0.05)] transition hover:border-[#d6e1d0]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
        {icon ? (
          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', iconBg)}>{icon}</div>
        ) : null}
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold leading-none tracking-tight text-slate-900 tabular-nums">{value}</span>
        {trend != null ? (
          <span className={cn('flex items-center gap-0.5 text-[11px] font-semibold', trendUp ? 'text-emerald-600' : 'text-rose-500')}>
            <TrendArrow up={trendUp} />
            {trendUp ? '+' : ''}{trend.value}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TrendArrow({ up }: { up: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      {up ? (
        <path d="M2 9l4-6 4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M2 3l4 6 4-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
