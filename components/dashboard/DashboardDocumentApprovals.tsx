"use client";

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import Badge from '../ui/Badge';
import DashboardCardHeader from './DashboardCardHeader';

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

  useEffect(() => {
    onVisibilityChange?.(shouldRender);
  }, [onVisibilityChange, shouldRender]);

  if (hideWhenEmpty && !shouldRender) {
    return null;
  }

  return (
    <div className="grid gap-3">
      {/* Rubriken bar tidigare en badge som växlade mellan "N väntar" och "Allt klart", en mening om
          vad kortet är till för, OCH en egen ruta under som upprepade samma siffra i klartext
          ("N dokument väntar på att du läser eller godkänner dem"). Tre sätt att säga en sak.

          "Allt klart"-läget är borta utan att något gick förlorat: startsidan skickar `hideWhenEmpty`
          och döljer hela kortet vid noll (se retur-null ovan), så den varianten av badgen kunde
          aldrig visas där. Nollfallets gröna rad nedan lever kvar för en anropare utan flaggan. */}
      <DashboardCardHeader
        title="Dokument att kvittera"
        meta={pendingCount > 0 ? <Badge variant="accent">{pendingCount} väntar</Badge> : null}
        action={
          <Link href="/mina-dokument" className="text-[13px] font-bold text-emerald-700 no-underline hover:text-emerald-800">
            Öppna alla
          </Link>
        }
      />

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
          <div className="grid gap-2">
            {pendingItems.map(item => (
              <div key={item.publicationId} className={cn('grid gap-2 rounded-[14px] border border-[#e3e9df] bg-[#f9fbf7] shadow-[0_1px_2px_rgba(15,23,42,0.05)]', compact ? 'px-3 py-2.5' : 'px-3.5 py-3')}>
                <div className="flex items-start justify-between gap-2">
                  <strong className={cn('text-slate-900', compact ? 'text-[13.5px]' : 'text-[15px]')}>{item.title}</strong>
                  <Badge className={cn('shrink-0 gap-1 px-[7px] py-1 text-[10.5px]', item.requiresApproval ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-slate-50 text-slate-600')}>
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
