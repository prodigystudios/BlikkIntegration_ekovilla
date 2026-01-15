"use client";

import React from 'react';

export type NewsItem = {
  id: string;
  headline: string;
  body: string;
  image_url?: string | null;
  created_at?: string;
};

export default function NewsModal({ open, item, onClose }: { open: boolean; item: NewsItem; onClose: () => void }) {
  if (!open) return null;

  const img = (item.image_url || '').trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nyheter"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 2600, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(720px, 94vw)', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
      >
        {img && (
          <div style={{ width: '100%', maxHeight: 260, overflow: 'hidden', background: '#f8fafc' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img}
              alt=""
              style={{ width: '100%', height: '100%', maxHeight: 260, objectFit: 'cover', display: 'block' }}
            />
          </div>
        )}

        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', lineHeight: 1.2 }}>{item.headline}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn btn--plain"
              style={{ padding: '6px 10px', borderRadius: 10 }}
            >
              Stäng
            </button>
          </div>

          <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {item.body}
          </div>
        </div>
      </div>
    </div>
  );
}
