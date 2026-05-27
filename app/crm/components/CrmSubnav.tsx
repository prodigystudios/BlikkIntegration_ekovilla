"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import type { UserRole } from '@/lib/roles';
import { getVisibleCrmNavItems } from '../_lib/nav';

export default function CrmSubnav({ role }: { role: UserRole | null }) {
  const pathname = usePathname();
  const items = getVisibleCrmNavItems(role);

  return (
    <nav aria-label="CRM navigation" className="grid gap-1.5 rounded-[20px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.86),rgba(255,255,255,0.96))] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Navigering</span>
      </div>

      <div className="hscroll flex flex-wrap gap-1.5 overflow-x-auto pb-0.5 md:overflow-visible">
        {items.map((item) => {
          const active = item.href === '/crm'
            ? pathname === '/crm'
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 shrink-0 items-center rounded-[14px] border px-3 py-1.5 text-[12px] font-semibold no-underline transition-[background-color,border-color,color,box-shadow,transform]',
                active
                  ? 'border-slate-900 bg-slate-900 text-white shadow-[0_10px_20px_rgba(15,23,42,0.14)]'
                  : 'border-transparent bg-white text-slate-600 shadow-[0_6px_14px_rgba(15,23,42,0.05)] hover:-translate-y-0.5 hover:border-slate-200 hover:text-slate-900'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}