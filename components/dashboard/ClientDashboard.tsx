"use client";
import React, { useMemo } from 'react';
import { QuickLinksGrid, QuickLink } from './QuickLinks';
import type { UserRole } from '../../lib/roles';
import { filterLinks, NAV_LINKS } from '../../lib/roles';

// Base mapping of NAV_LINKS (contains all). We'll adapt to QuickLink shape.
const baseExtra: Record<string, Omit<QuickLink, 'href' | 'title'>> = {
  '/egenkontroll': { desc: 'Skapa & arkivera egenkontroller', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <path d="M9 11.5l2 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
    </svg>
  ) },
  '/korjournal': { desc: 'Registrera och granska resor', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <path d="M4 16l2-8h12l2 8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  ) },
  '/planering': { desc: 'Se och planera uppdrag', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M8 2v4M16 2v4M3 10h18" strokeLinecap="round" />
    </svg>
  ) },
  '/material-kvalitet': { desc: 'Intern uppföljning & värden', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <path d="M4 18V9l8-5 8 5v9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 22v-7h6v7" strokeLinecap="round" />
    </svg>
  ) },
  '/admin': { desc: 'Hantera användare & behörigheter', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1 1 0 0 0 .2-1l-.6-1.1a7 7 0 0 0 0-1.8l.6-1.1a1 1 0 0 0-.2-1l-1.2-1.2a1 1 0 0 0-1-.2l-1.1.6a7 7 0 0 0-1.8 0l-1.1-.6a1 1 0 0 0-1 .2L9.6 7a1 1 0 0 0-.2 1l.6 1.1a7 7 0 0 0 0 1.8L9.4 12a1 1 0 0 0 .2 1l1.2 1.2a1 1 0 0 0 1 .2l1.1-.6a7 7 0 0 0 1.8 0l1.1.6a1 1 0 0 0 1-.2Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) },
};
// Dashboard main component (expects role only after cleanup of deprecated userQuickHrefs prop)
export function ClientDashboard({ role }: { role: UserRole | null }) {
  const links: QuickLink[] = useMemo(() => {
    const arr: QuickLink[] = [];
    // Always include /egenkontroll quick link even if not in NAV_LINKS (hidden from menu)
    if (baseExtra['/egenkontroll']) {
      arr.push({ href: '/egenkontroll', title: 'Ny Egenkontroll', ...baseExtra['/egenkontroll'] });
    }
    // Add role-filtered links from NAV_LINKS (excluding /egenkontroll to avoid duplicate)
    filterLinks(role).forEach(l => {
      if (l.href === '/egenkontroll') return; // skip if ever re-added to NAV_LINKS
      const extra = baseExtra[l.href];
      if (!extra) return;
      arr.push({ href: l.href, title: l.label, ...extra });
    });
    // Append admin dashboard quick link for admins (not part of NAV_LINKS to avoid menu duplication logic)
    if (role === 'admin' && baseExtra['/admin']) {
      arr.push({ href: '/admin', title: 'Admin', ...baseExtra['/admin'] });
    }
    return arr;
  }, [role]);
  return (
    <main style={{ padding: 32, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 30, letterSpacing: -0.5 }}>Översikt</h1>
      </header>

      <section style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 16, padding: 24, display: 'grid', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Snabba genvägar</h2>
        </div>
  <QuickLinksGrid links={links} />
      </section>

      <section style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 16, padding: 24, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Status</h2>
        <p style={{ margin: 0, color: '#374151' }}>Detta är startsidan. Lägg till widgets såsom dagens projekt, senaste dokument och notifieringar.</p>
      </section>
    </main>
  );
}
