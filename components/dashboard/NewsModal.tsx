"use client";

import React from 'react';
import Button from '../ui/Button';

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
      className="fixed inset-0 z-[2600] flex items-center justify-center bg-slate-900/55 p-4 [backdrop-filter:blur(2px)]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[720px] overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
        style={{ width: 'min(720px, 94vw)' }}
      >
        {img && (
          <div className="w-full overflow-hidden bg-slate-50" style={{ maxHeight: 260 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img}
              alt=""
              className="block h-full w-full object-cover"
              style={{ maxHeight: 260 }}
            />
          </div>
        )}

        <div className="grid gap-2.5 p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-extrabold leading-[1.2] text-slate-900">{item.headline}</div>
            </div>
            <Button
              type="button"
              onClick={onClose}
              variant="secondary"
              size="sm"
              className="rounded-[10px] px-2.5"
            >
              Stäng
            </Button>
          </div>

          <div className="whitespace-pre-wrap text-sm leading-[1.5] text-slate-700">
            {item.body}
          </div>
        </div>
      </div>
    </div>
  );
}
