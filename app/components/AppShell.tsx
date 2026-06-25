"use client";

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { UserRole } from '@/lib/roles';
import AppSidebar from './AppSidebar';

// Single app shell for all authenticated pages. A few routes render bare, with no
// chrome: the public auth + customer quote-signing pages, and the installer
// work-order field view (a focused mobile view opened via direct link; it's still
// auth-gated in its own page.tsx, it just doesn't want the sidebar). Everywhere
// else gets the unified context-aware sidebar + content area. The `crm-shell` class
// carries the sidebar/theme CSS variables app-wide.
const CHROMELESS_PREFIXES = ['/auth', '/kund/offert', '/arbetsorder'];

function isChromelessPath(pathname: string) {
  return CHROMELESS_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function AppShell({
  role,
  fullName,
  userInitial = 'U',
  children,
}: {
  role: UserRole | null;
  fullName: string | null;
  userInitial?: string;
  children: ReactNode;
}) {
  const pathname = usePathname() || '/';

  if (isChromelessPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="crm-shell flex flex-col lg:flex-row" style={{ height: '100dvh' }}>
      <AppSidebar role={role} userName={fullName} userInitial={userInitial} />
      <main
        className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-4 lg:px-6 lg:py-6"
        style={{ backgroundColor: 'var(--crm-content-bg)' }}
      >
        {children}
      </main>
    </div>
  );
}
