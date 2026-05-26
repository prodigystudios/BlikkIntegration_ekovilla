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
    <nav aria-label="CRM navigation" className="hscroll flex gap-2 overflow-x-auto pb-1">
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
              'inline-flex shrink-0 items-center rounded-full border px-3 py-2 text-sm font-semibold no-underline transition-colors',
              active
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}