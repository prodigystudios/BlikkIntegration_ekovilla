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

export default function MetricCard({ label, value, helper, icon, iconBg = 'bg-emerald-100', trend, className }: MetricCardProps) {
  const trendUp = trend != null && trend.value >= 0;

  return (
    <div className={cn('rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]', className)}>
      <div className="flex items-start justify-between gap-2">
        {icon ? (
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', iconBg)}>
            {icon}
          </div>
        ) : null}
        {trend != null ? (
          <span className={cn('ml-auto flex items-center gap-0.5 text-xs font-semibold', trendUp ? 'text-emerald-600' : 'text-rose-500')}>
            <TrendArrow up={trendUp} />
            {trendUp ? '+' : ''}{trend.value}%
          </span>
        ) : null}
      </div>
      <div className={cn('text-[2rem] font-bold tracking-tight text-slate-900', icon ? 'mt-3' : trend ? 'mt-6' : 'mt-0')}>
        {value}
      </div>
      <div className="mt-0.5 text-sm text-slate-500">{label}</div>
      {helper ? <div className="mt-1 text-xs text-slate-400">{helper}</div> : null}
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
