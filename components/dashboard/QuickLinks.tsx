"use client";
import Link from 'next/link';
import React from 'react';

export type QuickLink = {
  href: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  disabled?: boolean;
  disabledNote?: string; // optional small badge text e.g. 'Kommer snart'
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

export function QuickLinksGrid({ links, compact, extraCompact }: { links: QuickLink[]; compact?: boolean; extraCompact?: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: compact ? 12 : 16,
        gridTemplateColumns: extraCompact
          ? 'repeat(auto-fill,minmax(150px,1fr))'
          : compact
            ? 'repeat(auto-fill,minmax(180px,1fr))'
            : 'repeat(auto-fill,minmax(220px,1fr))',
      }}
    >
      {links.map(link => {
        const content = (
          <div
            style={{
              ...baseTile,
              padding: compact ? (extraCompact ? '12px 12px 14px' : '14px 14px 16px') : baseTile.padding,
              gap: compact ? 6 : 8,
              cursor: link.disabled ? 'not-allowed' : 'pointer',
              opacity: link.disabled ? 0.55 : 1,
              filter: link.disabled ? 'grayscale(15%)' : 'none'
            }}
            onMouseEnter={e => { if(link.disabled) return; e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(99,102,241,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.03)'; }}
            onFocus={e => { if(link.disabled) return; e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.35)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.03)'; }}
            aria-disabled={link.disabled || undefined}
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
      <div style={{ fontSize: compact ? 14 : 16, fontWeight: 600, letterSpacing: -0.3, display:'flex', alignItems:'center', gap:6 }}>
              {link.title}
              {link.disabled && (
        <span style={{ fontSize:9, fontWeight:600, background:'#f1f5f9', color:'#475569', padding:'2px 5px', borderRadius:999, border:'1px solid #e2e8f0' }}>{link.disabledNote || 'Kommer snart'}</span>
              )}
            </div>
      <div style={{ fontSize: compact ? 11.5 : 13, lineHeight: 1.35, color: '#475569' }}>{link.desc}</div>
      {!link.disabled && <span aria-hidden style={{ position: 'absolute', top: compact ? 8 : 12, right: compact ? 8 : 12, fontSize: compact ? 11 : 12, color: '#6366f1', fontWeight: 600 }}>↗</span>}
          </div>
        );
        if (link.disabled) {
          return <div key={link.href}>{content}</div>;
        }
        return (
          <Link key={link.href} href={link.href} style={{ textDecoration:'none' }}>
            {content}
          </Link>
        );
      })}
    </div>
  );
}

// Icon-only vertical bar (used when dashboard quick links minimized)
export function QuickLinksIconBar({ links, activeHref }: { links: QuickLink[]; activeHref?: string }) {
  return (
    <nav aria-label="Snabba genvägar" style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {links.map(l => {
        const disabled = !!l.disabled;
        const base: React.CSSProperties = {
          width:56,
          height:56,
          border:'1px solid #e5e7eb',
          borderRadius:14,
          background: activeHref === l.href ? 'linear-gradient(135deg,#eef2ff,#e0e7ff)' : '#fff',
          color:'#4f46e5',
          display:'flex',
          alignItems:'center',
          justifyContent:'center',
          position:'relative',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? .55 : 1,
          textDecoration:'none',
          transition:'border-color .15s, box-shadow .15s, background .15s'
        };
        const inner = (
          <div
            style={base}
            onMouseEnter={e=>{ if(disabled) return; e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow='0 4px 10px rgba(99,102,241,0.25)'; }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow='none'; }}
            aria-disabled={disabled || undefined}
            title={l.title + (disabled && l.disabledNote ? ` – ${l.disabledNote}` : '')}
          >
            <span style={{ display:'inline-flex', width:30, height:30, alignItems:'center', justifyContent:'center' }}>{l.icon}</span>
            {disabled && (
              <span style={{ position:'absolute', bottom:4, right:4, fontSize:9, fontWeight:600, background:'#f1f5f9', padding:'2px 4px', borderRadius:6, border:'1px solid #e2e8f0', color:'#475569' }}>✕</span>
            )}
          </div>
        );
        if (disabled) return <div key={l.href}>{inner}</div>;
        return <Link key={l.href} href={l.href} style={{ textDecoration:'none' }}>{inner}</Link>;
      })}
    </nav>
  );
}
