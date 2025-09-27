"use client";
import Link from 'next/link';
import React from 'react';

export type QuickLink = {
  href: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
};

const baseTile: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '18px 18px 20px',
  border: '1px solid #e5e7eb',
  borderRadius: 16,
  background: 'linear-gradient(145deg,#ffffff,#f8fafc)',
  textDecoration: 'none',
  color: '#111827',
  boxShadow: '0 4px 10px rgba(0,0,0,0.03)',
  transition: 'border-color .15s, box-shadow .15s, transform .15s',
  outline: 'none',
};

export function QuickLinksGrid({ links }: { links: QuickLink[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))',
      }}
    >
      {links.map(link => (
        <Link
          key={link.href}
          href={link.href}
          style={baseTile}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(99,102,241,0.18)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.03)'; }}
          onFocus={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.35)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.03)'; }}
        >
          <div style={{
            width: 48,
            height: 48,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 14,
            background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)',
            color: '#4f46e5',
            boxShadow: 'inset 0 0 0 1px #c7d2fe'
          }}>
            {link.icon}
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.3 }}>{link.title}</div>
          <div style={{ fontSize: 13, lineHeight: 1.4, color: '#475569' }}>{link.desc}</div>
          <span aria-hidden style={{ position: 'absolute', top: 12, right: 12, fontSize: 12, color: '#6366f1', fontWeight: 600 }}>↗</span>
        </Link>
      ))}
    </div>
  );
}
