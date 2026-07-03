"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import {
  FAULT_CATEGORIES,
  FAULT_STATUSES,
  categoryLabel,
  statusLabel,
  type FaultCategory,
  type FaultStatus,
  type FaultReportView,
  type FaultReportUpdateView,
} from '@/lib/domains/fault-reports/types';

const NOTICE = 'Detta skickas till arbetsledare som tar vid och återkopplar sedan till dig i ärendet.';

const statusMeta: Record<FaultStatus, { badge: string; accent: string }> = {
  new: { badge: 'border-sky-200 bg-sky-50 text-sky-800', accent: 'bg-sky-400' },
  in_progress: { badge: 'border-amber-200 bg-amber-50 text-amber-800', accent: 'bg-amber-400' },
  resolved: { badge: 'border-emerald-200 bg-emerald-50 text-emerald-700', accent: 'bg-emerald-500' },
};

type Tab = 'new' | 'mine' | 'inbox';

export default function FelanmalanClient({ isRecipient }: { isRecipient: boolean }) {
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get('arende');
  const deepLinkScope = searchParams.get('scope');

  const [tab, setTab] = useState<Tab>(deepLinkScope === 'inbox' && isRecipient ? 'inbox' : deepLinkId ? 'mine' : 'new');
  const [detail, setDetail] = useState<FaultReportView | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  return (
    <div className="grid grid-cols-1 gap-4">
      <header className="grid gap-1">
        <h1 className={crm.pageTitle}>Felanmälan</h1>
        <p className={crm.pageSubtitle}>Anmäl trasig utrustning — arbetsledare tar vid och återkopplar i ärendet.</p>
      </header>

      <div role="tablist" aria-label="Felanmälan" className="flex flex-wrap gap-2">
        <TabButton active={tab === 'new'} onClick={() => setTab('new')}>Ny felanmälan</TabButton>
        <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>Mina ärenden</TabButton>
        {isRecipient && <TabButton active={tab === 'inbox'} onClick={() => setTab('inbox')}>Inkorg</TabButton>}
      </div>

      {tab === 'new' && <NewReportForm onCreated={() => { setTab('mine'); setReloadToken((t) => t + 1); }} />}
      {tab === 'mine' && <ReportList scope="mine" onOpen={setDetail} deepLinkId={deepLinkId} reloadToken={reloadToken} />}
      {tab === 'inbox' && isRecipient && <ReportList scope="inbox" onOpen={setDetail} deepLinkId={deepLinkScope === 'inbox' ? deepLinkId : null} reloadToken={reloadToken} />}

      {detail && (
        <ReportDetailModal
          reportId={detail.id}
          initial={detail}
          canRespond={isRecipient}
          onClose={() => setDetail(null)}
          onChanged={() => setReloadToken((t) => t + 1)}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
        active
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[0_8px_20px_rgba(20,44,27,0.08)]'
          : 'border-[#e0e8dc] bg-white text-slate-700 hover:border-emerald-200 hover:bg-[#f9fbf7]',
      )}
    >
      {children}
    </button>
  );
}

function NewReportForm({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [category, setCategory] = useState<FaultCategory | ''>('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!category) { setError('Välj vad felanmälan gäller.'); return; }
    if (!comment.trim()) { setError('Beskriv vad som är fel.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/felanmalan/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, comment: comment.trim() }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || 'Kunde inte skicka felanmälan.');
      toast.success('Felanmälan skickad — arbetsledare är notifierade.');
      setCategory('');
      setComment('');
      onCreated();
    } catch (err: any) {
      setError(err?.message || 'Kunde inte skicka felanmälan.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className={cn(crm.cardInner, 'grid max-w-2xl gap-4')}>
      <div className="grid gap-1.5">
        <label htmlFor="fault-category" className={crm.label}>Vad gäller det?</label>
        <Select
          id="fault-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as FaultCategory)}
          disabled={submitting}
        >
          <option value="" disabled>Välj utrustning…</option>
          {FAULT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{categoryLabel[c]}</option>
          ))}
        </Select>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="fault-comment" className={crm.label}>Vad är fel?</label>
        <Textarea
          id="fault-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Beskriv felet så tydligt du kan…"
          disabled={submitting}
        />
      </div>

      {error && <p className="m-0 text-sm text-red-700">{error}</p>}

      <p className="m-0 rounded-lg border border-[#e0e8dc] bg-[#eef4ea] px-3.5 py-2.5 text-[13px] text-slate-600">
        {NOTICE}
      </p>

      <div>
        <button
          type="submit"
          disabled={submitting}
          className={cn(crm.primaryButton, 'disabled:cursor-not-allowed disabled:opacity-60')}
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          {submitting ? 'Skickar…' : 'Anmäl'}
        </button>
      </div>
    </form>
  );
}

function ReportList({ scope, onOpen, deepLinkId, reloadToken }: { scope: 'mine' | 'inbox'; onOpen: (r: FaultReportView) => void; deepLinkId: string | null; reloadToken: number }) {
  const [items, setItems] = useState<FaultReportView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FaultStatus | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/felanmalan/reports?scope=${scope}`, { cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || 'Kunde inte ladda ärenden.');
      setItems((j?.data?.items || []) as FaultReportView[]);
    } catch (err: any) {
      setError(err?.message || 'Kunde inte ladda ärenden.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load, reloadToken]);

  // Auto-open a deep-linked ärende ONCE per id — not on every subsequent reload (a reply save
  // bumps reloadToken → load() toggles `loading`, which would otherwise re-open the modal).
  const openedDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkId || loading) return;
    if (openedDeepLinkRef.current === deepLinkId) return;
    const found = items.find((r) => r.id === deepLinkId);
    if (found) {
      openedDeepLinkRef.current = deepLinkId;
      onOpen(found);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkId, loading]);

  const visible = useMemo(
    () => (statusFilter === 'all' ? items : items.filter((r) => r.status === statusFilter)),
    [items, statusFilter],
  );

  return (
    <div className="grid gap-3">
      {scope === 'inbox' && (
        <div className="flex flex-wrap gap-2">
          <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>Alla ({items.length})</FilterChip>
          {FAULT_STATUSES.map((s) => (
            <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
              {statusLabel[s]} ({items.filter((r) => r.status === s).length})
            </FilterChip>
          ))}
        </div>
      )}

      {loading && <p className="m-0 text-sm text-slate-500">Laddar…</p>}
      {error && <p className="m-0 text-sm text-red-700">{error}</p>}
      {!loading && !error && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#d5e0cf] bg-[#f4f8f1] px-4 py-8 text-center">
          <p className="m-0 text-sm text-slate-500">
            {scope === 'mine' ? 'Du har inga felanmälningar ännu.' : 'Inga felanmälningar här.'}
          </p>
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <ul role="list" className="m-0 grid list-none gap-1 p-0">
          {visible.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onOpen(r)}
                className="group flex w-full items-stretch overflow-hidden rounded-lg border border-[#e0e8dc] bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors hover:border-[#cfdcc9]"
              >
                <span className={cn('w-1.5 shrink-0', statusMeta[r.status].accent)} aria-hidden />
                <span className="grid flex-1 gap-0.5 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-slate-900">{r.category_label}</span>
                    <span className={cn(crm.badge, statusMeta[r.status].badge)}>{r.status_label}</span>
                  </span>
                  <span className="line-clamp-1 text-[12px] text-slate-600">{r.comment}</span>
                  <span className="text-[11px] text-slate-400">
                    {scope === 'inbox' ? `${r.reporter_name} · ` : ''}{formatDate(r.created_at)}
                    {r.reply ? ' · Besvarad' : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[13px] font-semibold transition-colors',
        active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-[#e0e8dc] bg-white text-slate-600 hover:border-emerald-200',
      )}
    >
      {children}
    </button>
  );
}

function ReportDetailModal({
  reportId,
  initial,
  canRespond,
  onClose,
  onChanged,
}: {
  reportId: string;
  initial: FaultReportView;
  canRespond: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [report, setReport] = useState<FaultReportView>(initial);
  const [history, setHistory] = useState<FaultReportUpdateView[]>([]);
  const [loading, setLoading] = useState(true);
  // Status defaults to the current one; the reply field starts EMPTY — each save is a NEW entry,
  // never an edit of a previous reply (so we never accidentally resend the last one).
  const [status, setStatus] = useState<FaultStatus>(initial.status);
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/felanmalan/reports/${reportId}`, { cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.data) {
        setReport(j.data.item as FaultReportView);
        setHistory((j.data.updates || []) as FaultReportUpdateView[]);
        setStatus((j.data.item as FaultReportView).status);
      }
    } catch { /* keep the initial snapshot */ } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/felanmalan/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reply: reply.trim() || null }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || 'Kunde inte spara.');
      toast.success('Ärendet uppdaterat — anmälaren är notifierad.');
      setReply('');
      await loadDetail();
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Kunde inte spara.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Felanmälan"
      maxWidth="sm:max-w-[560px]"
      header={
        <div className="grid gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="m-0 text-base font-bold text-slate-900">{report.category_label}</h2>
            <span className={cn(crm.badge, statusMeta[report.status].badge)}>{report.status_label}</span>
          </div>
          <p className="m-0 text-[12px] text-slate-500">{report.reporter_name} · {formatDate(report.created_at)}</p>
        </div>
      }
      footer={
        canRespond ? (
          <>
            <button type="button" onClick={onClose} className={cn(crm.ghostButton, 'flex-1 sm:flex-none sm:px-5')}>Stäng</button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={cn(crm.primaryButton, 'flex-1 justify-center disabled:opacity-60 sm:flex-none sm:px-5')}
              style={{ backgroundColor: 'var(--crm-primary)' }}
            >
              {saving ? 'Sparar…' : 'Spara & återkoppla'}
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose} className={cn(crm.ghostButton, 'flex-1 sm:flex-none sm:px-5')}>Stäng</button>
        )
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1">
          <span className={crm.label}>Beskrivning</span>
          <p className="m-0 whitespace-pre-wrap text-sm text-slate-800">{report.comment}</p>
        </div>

        {/* History timeline — everything a supervisor has sent, oldest first. */}
        <div className="grid gap-1.5">
          <span className={crm.label}>Historik</span>
          {loading ? (
            <p className="m-0 text-sm text-slate-400">Laddar…</p>
          ) : history.length === 0 ? (
            <p className="m-0 text-sm italic text-slate-400">Ingen återkoppling ännu.</p>
          ) : (
            <ul role="list" className="m-0 grid list-none gap-2 p-0">
              {history.map((h) => (
                <li key={h.id} className="grid gap-1 rounded-lg border border-[#e0e8dc] bg-white px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(crm.badge, statusMeta[h.status].badge)}>{h.status_label}</span>
                    <span className="text-[11px] text-slate-400">{h.responder_name} · {formatDate(h.created_at)}</span>
                  </div>
                  {h.reply && <p className="m-0 whitespace-pre-wrap text-sm text-slate-800">{h.reply}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canRespond && (
          <div className="grid gap-4 border-t border-slate-100 pt-4">
            <div className="grid gap-1.5">
              <label htmlFor="fault-status" className={crm.label}>Ny status</label>
              <Select id="fault-status" value={status} onChange={(e) => setStatus(e.target.value as FaultStatus)} disabled={saving}>
                {FAULT_STATUSES.map((s) => (
                  <option key={s} value={s}>{statusLabel[s]}</option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="fault-reply" className={crm.label}>Nytt svar till anmälaren</label>
              <Textarea id="fault-reply" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Skriv en återkoppling…" disabled={saving} />
            </div>
            {error && <p className="m-0 text-sm text-red-700">{error}</p>}
          </div>
        )}
      </div>
    </CrmModal>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
