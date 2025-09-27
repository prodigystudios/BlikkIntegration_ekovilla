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
  '/archive': { desc: 'Arkiverade egenkontroller', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
      <path d="M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" />
      <path d="M3 4h18v3H3Z" />
      <path d="M9 11h6" strokeLinecap="round" />
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
  '/kontakt-lista': { desc: 'Kontakt & adresser', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" fill="none" aria-hidden>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) },
  '/dokument-information': { desc: 'Dokument & information', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" fill="none" aria-hidden>
      <path d="M6 2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <path d="M13 2v6h6" />
      <path d="M8 13h8M8 17h5" strokeLinecap="round" />
    </svg>
  ) },
  '/bestallning-klader': { desc: 'Beställ kläder & material', icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" fill="none" aria-hidden>
      <path d="M6 6h15l-1.2 8.5a2 2 0 0 1-2 1.7H9.3a2 2 0 0 1-2-1.6L5.2 3.7A1 1 0 0 0 4.2 3H2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
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
    // Explicit role-based sets as requested
  if (role === 'member') {
      return [
        { href: '/egenkontroll', title: 'Skapa egenkontroll', ...baseExtra['/egenkontroll'] },
    { href: '/bestallning-klader', title: 'Beställ kläder & annat', ...baseExtra['/bestallning-klader'] },
        { href: '/kontakt-lista', title: 'Kontakt', ...baseExtra['/kontakt-lista'] },
        { href: '/dokument-information', title: 'Dokument & information', ...baseExtra['/dokument-information'] },
      ];
    }
    if (role === 'sales') {
      return [
        { href: '/archive', title: 'Egenkontroll arkiv', ...baseExtra['/archive'] },
        { href: '/korjournal', title: 'Körjournal', ...baseExtra['/korjournal'] },
        { href: '/planering', title: 'Planering', ...baseExtra['/planering'] },
        { href: '/kontakt-lista', title: 'Kontakt', ...baseExtra['/kontakt-lista'] },
      ];
    }
    if (role === 'admin') {
      return [
        { href: '/egenkontroll', title: 'Ny egenkontroll', ...baseExtra['/egenkontroll'] },
        { href: '/archive', title: 'Egenkontroll arkiv', ...baseExtra['/archive'] },
        { href: '/korjournal', title: 'Körjournal', ...baseExtra['/korjournal'] },
        { href: '/planering', title: 'Planering', ...baseExtra['/planering'] },
        { href: '/admin', title: 'Admin', ...baseExtra['/admin'] },
      ];
    }
    // Fallback before role known: minimal set
    return [
      { href: '/egenkontroll', title: 'Egenkontroll', ...baseExtra['/egenkontroll'] },
    ];
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
