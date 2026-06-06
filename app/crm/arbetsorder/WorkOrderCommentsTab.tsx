"use client";

import { useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import MentionTextarea, { type MentionUser } from '@/app/crm/components/MentionTextarea';

export type CommentItem = {
  id: string;
  work_order_id: string;
  created_by: string;
  body: string;
  created_at: string;
  author?: { full_name?: string | null } | null;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '–' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

type Props = {
  comments: CommentItem[];
  loading: boolean;
  currentUserId: string | null;
  mentionUsers: MentionUser[];
  onCreate: (body: string) => Promise<boolean>;
  onUpdate: (id: string, body: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
};

export default function WorkOrderCommentsTab({ comments, loading, currentUserId, mentionUsers, onCreate, onUpdate, onDelete }: Props) {
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function submitCreate() {
    setCreating(true);
    const ok = await onCreate(draft);
    if (ok) setDraft('');
    setCreating(false);
  }

  function startEdit(item: CommentItem) {
    setConfirmDeleteId(null);
    setEditingId(item.id);
    setEditBody(item.body);
  }

  async function submitEdit(id: string) {
    setBusyId(id);
    const ok = await onUpdate(id, editBody);
    if (ok) setEditingId(null);
    setBusyId(null);
  }

  async function confirmDelete(id: string) {
    setBusyId(id);
    await onDelete(id);
    setBusyId(null);
    setConfirmDeleteId(null);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className={cn(crm.cardInner, 'grid gap-3')}>
        <p className={crm.sectionTitle}>Projektkommentarer</p>
        {loading ? <div className="text-sm text-slate-500">Laddar kommentarer…</div> : null}
        {!loading && comments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-4 py-6 text-sm text-slate-500">Inga kommentarer ännu.</div>
        ) : null}
        {!loading ? comments.map((item) => {
          const isOwn = !!currentUserId && item.created_by === currentUserId;
          if (editingId === item.id) {
            return (
              <div key={item.id} className="grid gap-2 rounded-xl border border-emerald-200 bg-[#f1f5ee] px-3 py-3">
                <MentionTextarea value={editBody} onChange={setEditBody} users={mentionUsers} rows={3} />
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setEditingId(null)} className={crm.ghostButton}>Avbryt</button>
                  <button type="button" onClick={() => submitEdit(item.id)} disabled={busyId === item.id} className={cn(crm.saveButton, 'h-9 w-auto px-4')}>
                    {busyId === item.id ? 'Sparar…' : 'Spara'}
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={item.id} className="grid gap-1 rounded-xl border border-[#e0e8dc] bg-[#f1f5ee] px-3 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <strong className="text-slate-900">{item.author?.full_name || 'Kommentar'}</strong>
                <span className="text-xs text-slate-400">{formatDateTime(item.created_at)}</span>
              </div>
              <div className="text-slate-600">{item.body}</div>
              {isOwn ? (
                <div className="flex items-center justify-end gap-3 pt-0.5">
                  {confirmDeleteId === item.id ? (
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">Ta bort?</span>
                      <button type="button" onClick={() => confirmDelete(item.id)} disabled={busyId === item.id} className="font-semibold text-rose-600 hover:text-rose-700">Ja</button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-slate-400 hover:text-slate-600">Nej</button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-3 text-xs">
                      <button type="button" onClick={() => startEdit(item)} className="font-medium text-slate-500 hover:text-slate-800">Redigera</button>
                      <button type="button" onClick={() => setConfirmDeleteId(item.id)} className="font-medium text-slate-400 hover:text-rose-500">Ta bort</button>
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          );
        }) : null}
      </div>

      <div className={cn(crm.cardInner, 'grid gap-3 lg:content-start')}>
        <p className={crm.sectionTitle}>Ny kommentar</p>
        <MentionTextarea value={draft} onChange={setDraft} users={mentionUsers} rows={8} placeholder="Skriv en kommentar… använd @ för att tagga någon" />
        <button type="button" onClick={submitCreate} disabled={creating} className={crm.saveButton}>
          {creating ? 'Sparar kommentar…' : 'Spara kommentar'}
        </button>
      </div>
    </div>
  );
}
