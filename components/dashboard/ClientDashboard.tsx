"use client";
import React from 'react';
import { QuickLinksGrid, QuickLink } from './QuickLinks';

const links: QuickLink[] = [
  {
    href: '/egenkontroll',
    title: 'Egenkontroll',
    desc: 'Skapa & arkivera egenkontroller',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
        <path d="M9 11.5l2 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
      </svg>
    ),
  },
  {
    href: '/korjournal',
    title: 'Körjournal',
    desc: 'Registrera och granska resor',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
        <path d="M4 16l2-8h12l2 8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="17" r="2" />
        <circle cx="17" cy="17" r="2" />
      </svg>
    ),
  },
  {
    href: '/planering',
    title: 'Planering',
    desc: 'Se och planera uppdrag',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <path d="M8 2v4M16 2v4M3 10h18" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/material-kvalitet',
    title: 'Materialkvalitet',
    desc: 'Intern uppföljning & värden',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" fill="none" aria-hidden>
        <path d="M4 18V9l8-5 8 5v9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 22v-7h6v7" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function ClientDashboard() {
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
