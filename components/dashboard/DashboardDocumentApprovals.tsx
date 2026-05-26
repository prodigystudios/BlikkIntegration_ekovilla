"use client";

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import Badge from '../ui/Badge';

type DashboardDocumentItem = {
  publicationId: string;
  title: string;
  dueAt: string | null;
  requiresApproval: boolean;
  receipt: { approvedAt: string | null; firstOpenedAt?: string | null } | null;
};

function isCompleted(item: DashboardDocumentItem) {
  return !!item.receipt?.approvedAt || (!item.requiresApproval && !!item.receipt?.firstOpenedAt);
}

export default function DashboardDocumentApprovals({ compact, hideWhenEmpty, onVisibilityChange }: { compact?: boolean; hideWhenEmpty?: boolean; onVisibilityChange?: (visible: boolean) => void }) {
  const [items, setItems] = useState<DashboardDocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/documents/publications/mine', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Kunde inte ladda dokument');
        if (!active) return;
        setItems(Array.isArray(json.items) ? json.items : []);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message || 'Kunde inte ladda dokument');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const pendingItems = useMemo(
    () => items.filter(item => !isCompleted(item)).slice(0, 3),
    [items]
  );
  const pendingCount = items.filter(item => !isCompleted(item)).length;
  const shouldRender = loading || !!error || pendingCount > 0;
  const highlightTone = pendingCount > 0
    ? { border: '1px solid #bfdbfe', background: 'linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)' }
    : { border: '1px solid #e5e7eb', background: '#ffffff' };

  useEffect(() => {
    onVisibilityChange?.(shouldRender);
  }, [onVisibilityChange, shouldRender]);

  if (hideWhenEmpty && !shouldRender) {
    return null;
  }

  return (
    <div className={cn('grid', compact ? 'gap-2.5' : 'gap-3.5')}>
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-1">
          <div className="inline-flex flex-wrap items-center gap-2">
            <h2 className={cn('m-0 font-bold text-slate-900', compact ? 'text-base' : 'text-xl')}>Dokument att kvittera</h2>
            <Badge variant={pendingCount > 0 ? 'accent' : 'neutral'} className="gap-1.5 px-2 py-1 text-[11px]">
              {pendingCount > 0 ? `${pendingCount} väntar` : 'Allt klart'}
            </Badge>
          </div>
          {(!compact || pendingCount > 0) && <p className={cn('m-0 text-slate-500', compact ? 'text-xs' : 'text-[13px]')}>Dokument som kräver läsning eller godkännande ska fångas direkt.</p>}
        </div>
        <Link href="/mina-dokument" className="text-[13px] font-bold text-blue-600 no-underline hover:text-blue-700">
          Öppna alla
        </Link>
      </div>

      {loading && <p className="m-0 text-xs text-slate-500">Laddar…</p>}
      {error && <p className="m-0 text-xs text-red-700">{error}</p>}
      {!loading && !error && pendingCount === 0 && (
        <div className={cn('inline-flex w-fit items-center gap-2 rounded-full border border-green-200 bg-green-50 text-green-800 font-semibold', compact ? 'px-2.5 py-2 text-xs' : 'px-3 py-2.5 text-[13px]')}>
          <span className="h-2 w-2 rounded-full bg-green-500" />
          Inga dokument väntar på kvittens.
        </div>
      )}
      {!loading && !error && pendingCount > 0 && (
        <>
          <div
            className={cn('grid gap-1 rounded-2xl', compact ? 'px-3 py-2.5' : 'px-3.5 py-3')}
            style={highlightTone}
          >
            <p className={cn('m-0 font-bold text-slate-900', compact ? 'text-[13px]' : 'text-sm')}>
              {pendingCount} dokument väntar på att du läser eller godkänner dem.
            </p>
            <p className={cn('m-0 text-slate-500', compact ? 'text-[11.5px]' : 'text-[12.5px]')}>
              Börja med det som har deadline eller kräver aktiv kvittens.
            </p>
          </div>
          <div className="grid gap-2">
            {pendingItems.map(item => (
              <div key={item.publicationId} className={cn('grid gap-2 rounded-[14px] border border-[#dbe4ef] bg-[#f8fbff] shadow-[0_6px_16px_rgba(15,23,42,0.04)]', compact ? 'px-3 py-2.5' : 'px-3.5 py-3')}>
                <div className="flex items-start justify-between gap-2">
                  <strong className={cn('text-slate-900', compact ? 'text-[13.5px]' : 'text-[15px]')}>{item.title}</strong>
                  <Badge className={cn('shrink-0 gap-1 px-[7px] py-1 text-[10.5px]', item.requiresApproval ? 'border-blue-200 bg-blue-100 text-blue-700' : 'border-cyan-100 bg-cyan-50 text-cyan-700')}>
                    {item.requiresApproval ? 'Godkänn' : 'Läs'}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className={cn('text-slate-500', compact ? 'text-[11px]' : 'text-xs')}>
                    {item.dueAt ? `Senast ${new Date(item.dueAt).toLocaleDateString('sv-SE')}` : 'Ingen deadline'}
                  </span>
                  <Link href="/mina-dokument" className={cn('rounded-[10px] border border-slate-300 bg-white px-2.5 py-1.5 font-bold text-slate-900 no-underline hover:bg-slate-50', compact ? 'text-xs' : 'text-[13px]')}>
                    Hantera
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
