"use client";

import React from 'react';
import { cn } from '../../../lib/shared/cn';
import { crm } from '../../crm/lib/crmTokens';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import { ADMIN_EMPTY_BOX, ADMIN_ERROR_BOX } from '../components/adminUi';
import { changelogCategoryMeta, formatChangelogStamp } from '../../_lib/changelogTokens';
import {
  CHANGELOG_CATEGORIES,
  categoryLabel,
  type ChangelogCategory,
  type ChangelogDraftView,
} from '../../../lib/domains/changelog/types';

// Admin → Changelog. Skriver de FRIA posterna.
//
// Ärendehärledda rader syns INTE här, med flit: de ägs av sitt ärende och publiceras i fliken
// Ärenden. Två vägar in i samma text hade blivit två sanningar. Vyn säger det rakt ut i stället för
// att lämna en gåta om varför en publicerad rad saknas.
//
// Utkast (published_at = null) finns för att en post oftast skrivs innan ändringen är ute. RLS
// döljer dem för alla utom admin.
//
export default function AdminChangelog() {
  const [entries, setEntries] = React.useState<ChangelogDraftView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/changelog?scope=drafts', { cache: 'no-store', credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
      setEntries((body.data.entries || []) as ChangelogDraftView[]);
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  return (
    <div className="grid grid-cols-1 gap-4 p-5">
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-bold text-slate-900">Changelog</h2>
        <p className="m-0 text-sm text-slate-600">
          Det som visas under <strong>Nytt i appen</strong> på CRM-översikten. Poster som kommer från
          ett rapporterat ärende skrivs i fliken <strong>Ärenden</strong> och listas inte här.
        </p>
      </div>

      <NewEntryForm onSaved={load} />

      {error ? (
        <div role="alert" className={ADMIN_ERROR_BOX}>{error}</div>
      ) : null}

      {loading ? (
        <p className="m-0 text-sm text-slate-400">Laddar…</p>
      ) : entries.length === 0 && !error ? (
        <div className={ADMIN_EMPTY_BOX}>
          <p className="m-0 text-sm text-slate-500">Inga egna poster ännu.</p>
        </div>
      ) : (
        <ul role="list" className="m-0 grid list-none gap-1 p-0">
          {entries.map((entry) => (
            <li key={entry.id}>
              <EntryRow entry={entry} onChanged={load} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewEntryForm({ onSaved }: { onSaved: () => void }) {
  const [category, setCategory] = React.useState<ChangelogCategory>('fixed');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (publish: boolean) => {
    if (!title.trim()) {
      setError('Skriv vad som ändrats.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/changelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ category, title: title.trim(), body: body.trim() || null, publish }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) throw new Error(payload?.error || `Fel (${res.status})`);
      setTitle('');
      setBody('');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn(crm.cardInner, 'grid gap-3')}>
      <span className={crm.label}>Ny post</span>

      <div className="grid gap-3 sm:grid-cols-[10rem_1fr] sm:items-start">
        <div className="grid gap-1.5">
          <label htmlFor="changelog-category" className={crm.label}>Sort</label>
          <Select
            id="changelog-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as ChangelogCategory)}
            disabled={saving}
          >
            {CHANGELOG_CATEGORIES.map((c) => (
              <option key={c} value={c}>{categoryLabel[c]}</option>
            ))}
          </Select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="changelog-title" className={crm.label}>Vad ändrades?</label>
          <Input
            id="changelog-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="T.ex. Ordern synkar nu kontakt och adress till Fortnox"
            maxLength={160}
            disabled={saving}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="changelog-body" className={crm.label}>Mer (frivilligt)</label>
        <Textarea
          id="changelog-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Bara när rubriken inte räcker."
          className="min-h-[60px]"
          maxLength={2000}
          disabled={saving}
        />
      </div>

      {error ? <p className="m-0 text-sm text-red-700">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={saving}
          className={cn(crm.formButton)}
          style={{ backgroundColor: 'var(--crm-primary, #1a3f26)' }}
        >
          {saving ? 'Sparar…' : 'Publicera'}
        </button>
        <button type="button" onClick={() => submit(false)} disabled={saving} className={cn(crm.ghostButton, 'h-9')}>
          Spara som utkast
        </button>
      </div>
    </div>
  );
}

function EntryRow({ entry, onChanged }: { entry: ChangelogDraftView; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const published = !!entry.published_at;
  const meta = changelogCategoryMeta[entry.category];

  const patch = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/changelog/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/changelog/${entry.id}`, { method: 'DELETE', credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="grid gap-2 rounded-lg border border-[#e0e8dc] bg-white px-3 py-2">
      <div className="flex flex-wrap items-start gap-2">
        <span
          aria-hidden
          className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[11px] font-bold', meta.glyphClass)}
        >
          {meta.glyph}
        </span>
        <div className="min-w-0 flex-1 grid gap-0.5">
          <span className="text-[13px] font-semibold text-slate-900">{entry.title}</span>
          {entry.body ? <span className="whitespace-pre-wrap text-[12px] text-slate-600">{entry.body}</span> : null}
          <span className="text-[11px] text-slate-400">
            {entry.category_label} · {entry.created_by_name}
            {published ? ` · publicerad ${formatChangelogStamp(entry.published_at as string)}` : ''}
          </span>
        </div>
        <span className={cn(crm.badge, published ? meta.badge : 'border-slate-200 bg-slate-50 text-slate-500')}>
          {published ? 'Publicerad' : 'Utkast'}
        </span>
      </div>

      {error ? <p className="m-0 text-[12px] text-red-700">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {published ? (
          <button
            type="button"
            onClick={() => patch({ publish: false })}
            disabled={busy}
            className={cn(crm.ghostButton, 'h-8')}
            title="Tas ur listan men behålls här"
          >
            Avpublicera
          </button>
        ) : (
          <button
            type="button"
            onClick={() => patch({ publish: true })}
            disabled={busy}
            className={cn(crm.formButton, 'h-8')}
            style={{ backgroundColor: 'var(--crm-primary, #1a3f26)' }}
          >
            Publicera
          </button>
        )}

        {confirmDelete ? (
          <>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className={cn(crm.ghostButton, 'h-8')}>
              Avbryt
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex h-8 items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
            >
              {busy ? 'Tar bort…' : 'Ja, ta bort'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            className={cn(crm.ghostButton, 'h-8 hover:border-rose-300 hover:text-rose-600')}
          >
            Ta bort
          </button>
        )}
      </div>
    </div>
  );
}
