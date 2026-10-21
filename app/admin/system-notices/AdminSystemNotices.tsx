"use client";

import React from 'react';
import { cn } from '../../../lib/shared/cn';
import { crm } from '../../crm/lib/crmTokens';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import Input from '../../../components/ui/Input';
import { ADMIN_CHECKBOX, ADMIN_EMPTY_BOX, ADMIN_ERROR_BOX } from '../components/adminUi';
import { APP_STATUS_REFRESH_EVENT, SystemNoticeStrip } from '../../components/AppStatusBanners';
import { isSystemNoticeActive } from '../../../lib/domains/systemNotices/notices';
import {
  SYSTEM_NOTICE_AREAS,
  SYSTEM_NOTICE_KINDS,
  systemNoticeAreaLabel,
  systemNoticeKindLabel,
  type SystemNoticeArea,
  type SystemNoticeKind,
  type SystemNoticeView,
} from '../../../lib/domains/systemNotices/types';

// Admin → Driftmeddelanden. Det som slås på här visas överst i appen för ALLA inloggade, även montörerna i fältvyn,
// inom en minut. Var och en kan stänga det för sig själv tills det ändras.
//
// Förhandsvisningen är bannerns egen komponent (SystemNoticeStrip), så det admin ser är det användarna får.

type FormValues = {
  kind: SystemNoticeKind;
  message: string;
  areas: SystemNoticeArea[];
  // <input type="datetime-local">-värdet i webbläsarens zon, eller '' = tills det slås av.
  endsAtLocal: string;
};

const EMPTY_FORM: FormValues = { kind: 'update', message: '', areas: [], endsAtLocal: '' };

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', payload?: unknown) {
  const res = await fetch(url, {
    method,
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
  // Bannern överst i den här fliken hämtar på nytt direkt; andra flikar och användare får det inom en minut.
  window.dispatchEvent(new Event(APP_STATUS_REFRESH_EVENT));
  return body.data;
}

// `initial` = värdena formuläret öppnades med (vid ändring). Sluttiden skickas bara när admin ändrat den: fältet visar
// den avrundad till minuten, och att skicka tillbaka den hade flyttat den upp till en minut — eller fått en sparning av
// bara texten avvisad som "passerad" när sluttiden låg inom samma minut.
function payloadFrom(values: FormValues, initial?: FormValues) {
  const payload: Record<string, unknown> = {
    kind: values.kind,
    message: values.message.trim(),
    affected_areas: values.areas,
  };
  if (!initial || values.endsAtLocal !== initial.endsAtLocal) payload.ends_at = fromLocalInputValue(values.endsAtLocal);
  return payload;
}

export default function AdminSystemNotices() {
  const [notices, setNotices] = React.useState<SystemNoticeView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => new Date());

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/system-notices', { cache: 'no-store', credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
      setNotices((body.data.notices || []) as SystemNoticeView[]);
      setNow(new Date());
    } catch (e) {
      // Listan behålls: en tom "Inget meddelande visas" bredvid felet hade fått admin att tro att inget är påslaget.
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const active = notices.filter((n) => isSystemNoticeActive(n, now));
  const history = notices.filter((n) => !isSystemNoticeActive(n, now));

  return (
    <div className="grid grid-cols-1 gap-4 p-5">
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-bold text-slate-900">Driftmeddelanden</h2>
        <p className="m-0 text-sm text-slate-600">
          Visas överst i appen för alla inloggade, även montörerna i fältvyn, inom en minut. Var och en kan dölja det
          för sig själv; ändrar du sort, text eller vad det påverkar visas det igen.
        </p>
      </div>

      <div className={cn(crm.cardInner, 'grid gap-3')}>
        <span className={crm.label}>Nytt meddelande</span>
        <NoticeForm
          initial={EMPTY_FORM}
          submitLabel="Visa meddelandet"
          busyLabel="Slår på…"
          resetOnSuccess
          onSubmit={async (values) => {
            await send('/api/admin/system-notices', 'POST', payloadFrom(values));
            await load();
          }}
        />
      </div>

      {error ? <div role="alert" className={ADMIN_ERROR_BOX}>{error}</div> : null}

      {loading ? (
        <p role="status" className="m-0 text-sm text-slate-500">Laddar…</p>
      ) : (
        <>
          <section className="grid gap-2" aria-labelledby="system-notices-active">
            <h3 id="system-notices-active" className="m-0 text-sm font-semibold text-slate-900">Visas nu</h3>
            {active.length === 0 ? (
              <div className={ADMIN_EMPTY_BOX}>
                <p className="m-0 text-sm text-slate-500">Inget meddelande visas just nu.</p>
              </div>
            ) : (
              <ul role="list" className="m-0 grid list-none gap-2 p-0">
                {active.map((notice) => (
                  <li key={notice.id}>
                    <ActiveNotice notice={notice} now={now} onChanged={load} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {history.length > 0 ? (
            <section className="grid gap-2" aria-labelledby="system-notices-history">
              <h3 id="system-notices-history" className="m-0 text-sm font-semibold text-slate-900">Tidigare</h3>
              <ul role="list" className="m-0 grid list-none gap-1 p-0">
                {history.map((notice) => (
                  <li key={notice.id}>
                    <HistoryNotice notice={notice} onChanged={load} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function NoticeForm({
  initial,
  submitLabel,
  busyLabel,
  resetOnSuccess = false,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  submitLabel: string;
  busyLabel: string;
  resetOnSuccess?: boolean;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [values, setValues] = React.useState<FormValues>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const idPrefix = React.useId();

  const toggleArea = (area: SystemNoticeArea) =>
    setValues((v) => ({
      ...v,
      areas: v.areas.includes(area) ? v.areas.filter((a) => a !== area) : SYSTEM_NOTICE_AREAS.filter((a) => a === area || v.areas.includes(a)),
    }));

  const submit = async () => {
    if (!values.message.trim()) {
      setError('Skriv vad som händer.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(values);
      if (resetOnSuccess) setValues(initial);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const preview: SystemNoticeView = {
    id: 'preview',
    kind: values.kind,
    kind_label: systemNoticeKindLabel[values.kind],
    message: values.message.trim() || 'Så här ser meddelandet ut.',
    areas: values.areas,
    starts_at: new Date(0).toISOString(),
    ends_at: fromLocalInputValue(values.endsAtLocal),
    created_by_name: '',
    updated_at: '',
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[13rem_1fr] sm:items-start">
        <div className="grid gap-1.5">
          <label htmlFor={`${idPrefix}-kind`} className={crm.label}>Sort</label>
          <Select
            id={`${idPrefix}-kind`}
            value={values.kind}
            onChange={(e) => setValues((v) => ({ ...v, kind: e.target.value as SystemNoticeKind }))}
            disabled={saving}
          >
            {SYSTEM_NOTICE_KINDS.map((k) => (
              <option key={k} value={k}>{systemNoticeKindLabel[k]}</option>
            ))}
          </Select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor={`${idPrefix}-message`} className={crm.label}>Vad händer?</label>
          <Textarea
            id={`${idPrefix}-message`}
            value={values.message}
            onChange={(e) => setValues((v) => ({ ...v, message: e.target.value }))}
            placeholder="T.ex. Vi uppdaterar offertflödet. Spara det du håller på med och ladda om om en stund."
            className="min-h-[60px]"
            maxLength={500}
            disabled={saving}
          />
        </div>
      </div>

      <fieldset className="m-0 grid gap-1.5 border-0 p-0">
        <legend className={cn(crm.label, 'mb-1.5 p-0')}>Påverkar</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {SYSTEM_NOTICE_AREAS.map((area) => (
            <label key={area} className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className={ADMIN_CHECKBOX}
                checked={values.areas.includes(area)}
                onChange={() => toggleArea(area)}
                disabled={saving}
              />
              {systemNoticeAreaLabel[area]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-1.5 sm:max-w-xs">
        <label htmlFor={`${idPrefix}-ends`} className={crm.label}>Beräknas klart (frivilligt)</label>
        <Input
          id={`${idPrefix}-ends`}
          type="datetime-local"
          value={values.endsAtLocal}
          onChange={(e) => setValues((v) => ({ ...v, endsAtLocal: e.target.value }))}
          disabled={saving}
        />
        <span className="text-[12px] text-slate-500">Meddelandet döljs av sig självt då. Tomt = tills du slår av det.</span>
      </div>

      <div className="grid gap-1.5">
        <span className={crm.label}>Så här ser det ut</span>
        <div className="overflow-hidden rounded-lg border border-[#e0e8dc]">
          <SystemNoticeStrip notice={preview} now={new Date()} announce={false} />
        </div>
      </div>

      {error ? <p role="alert" className="m-0 text-sm text-red-700">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className={cn(crm.formButton)}
          style={{ backgroundColor: 'var(--ek-green)' }}
        >
          {saving ? busyLabel : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={saving} className={cn(crm.ghostButton, 'h-9')}>
            Avbryt
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ActiveNotice({ notice, now, onChanged }: { notice: SystemNoticeView; now: Date; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/admin/system-notices/${notice.id}`, 'PATCH', { end: true });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (editing) {
    const initial: FormValues = { kind: notice.kind, message: notice.message, areas: notice.areas, endsAtLocal: toLocalInputValue(notice.ends_at) };
    return (
      <div className={cn(crm.cardInner, 'grid gap-3')}>
        <span className={crm.label}>Ändra meddelandet</span>
        <NoticeForm
          initial={initial}
          submitLabel="Spara ändringen"
          busyLabel="Sparar…"
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            await send(`/api/admin/system-notices/${notice.id}`, 'PATCH', payloadFrom(values, initial));
            setEditing(false);
            await onChanged();
          }}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-lg border border-[#e0e8dc] bg-[#f9fbf7] p-2">
      <div className="overflow-hidden rounded-md border border-[#e0e8dc]">
        <SystemNoticeStrip notice={notice} now={now} announce={false} />
      </div>
      <p className="m-0 px-1 text-[12px] text-slate-500">
        Påslaget av {notice.created_by_name} {new Date(notice.starts_at).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
      {error ? <p role="alert" className="m-0 px-1 text-[12px] text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2 px-1 pb-1">
        <button type="button" onClick={() => setEditing(true)} disabled={busy} className={cn(crm.ghostButton, 'h-8')}>
          Ändra
        </button>
        <button
          type="button"
          onClick={end}
          disabled={busy}
          className="inline-flex h-8 items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
        >
          {busy ? 'Slår av…' : 'Slå av nu'}
        </button>
      </div>
    </div>
  );
}

function HistoryNotice({ notice, onChanged }: { notice: SystemNoticeView; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/admin/system-notices/${notice.id}`, 'DELETE');
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const stamp = (iso: string) => new Date(iso).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="grid gap-1 rounded-lg border border-[#e0e8dc] bg-[#f9fbf7] px-3 py-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-[13px] text-slate-800">
            <span className="font-semibold">{notice.kind_label}</span> {notice.message}
          </span>
          <span className="text-[11px] text-slate-500">
            {notice.created_by_name}, {stamp(notice.starts_at)}
            {notice.ends_at ? ` till ${stamp(notice.ends_at)}` : ''}
          </span>
        </div>
        {confirmDelete ? (
          <div className="flex gap-2">
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
          </div>
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
      {error ? <p role="alert" className="m-0 text-[12px] text-red-700">{error}</p> : null}
    </div>
  );
}
