"use client";
import React from 'react';
import { crm } from '../../crm/lib/crmTokens';
import { cn } from '../../../lib/shared/cn';
import { ADMIN_CARD, ADMIN_CHECKBOX, ADMIN_COLHEAD, ADMIN_ERROR_BOX, ADMIN_NOTICE_BOX } from '../components/adminUi';
import type { TimeReferenceItem, TimeReferenceKind } from '../../../lib/domains/time/reference';


// Admin → Tidkoder. Referensdatan för tidrapporteringen (fas 4.1).
//
// Listorna bodde i Blikk och hämtades live vid varje modalöppning. Nu är de våra: knappen
// "Hämta från Blikk" fyller dem en gång, sedan underhålls de här. `payroll_code` är den enda
// kolumn lönebyrån bryr sig om — den är tom efter importen och måste fyllas i för hand, så den
// har en egen varningsruta högst upp.
//
// OBS <input> är 100 % brett som default (globals.css). Sedan 2026-08-16 ligger den regeln i
// `:where()` och har specificitet noll, så en breddklass på fältet vinner numera — men vyn styr
// fortfarande bredden på omslutande element, vilket är det som redan är inlärt här.

type Section = { kind: TimeReferenceKind; label: string; help: string };

const SECTIONS: Section[] = [
  { kind: 'time_code', label: 'Tidkoder', help: 'Väljs på varje tidrad. Styr vilken lönesort timmarna hamnar på.' },
  { kind: 'internal_project', label: 'Internprojekt', help: 'Tid som inte hör till en arbetsorder — verkstad, möten, utbildning.' },
  { kind: 'absence_type', label: 'Frånvarotyper', help: 'Sjuk, VAB, semester, permission. Räknas aldrig som arbetad tid.' },
];

type ReferenceData = Record<TimeReferenceKind, TimeReferenceItem[]>;

const EMPTY: ReferenceData = { time_code: [], internal_project: [], absence_type: [] };

async function getJson(url: string) {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
  return body.data;
}

async function sendJson(url: string, method: 'POST' | 'PATCH', payload?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
  return body.data;
}

export default function AdminTimeReference() {
  const [data, setData] = React.useState<ReferenceData>(EMPTY);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [newName, setNewName] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    try {
      // includeInactive: annars går en inaktiverad rad inte att återaktivera härifrån.
      setData(await getJson('/api/time/reference?includeInactive=1'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  // Den enda siffra som betyder något innan löneunderlaget körs skarpt: aktiva rader utan lönesort
  // blir rader byrån inte kan placera.
  const missingPayrollCode = React.useMemo(
    () => SECTIONS.reduce(
      (sum, section) => sum + data[section.kind].filter((item) => item.is_active && !item.payroll_code).length,
      0,
    ),
    [data],
  );

  async function patchItem(kind: TimeReferenceKind, item: TimeReferenceItem, patch: Record<string, unknown>) {
    setBusyKey(`${kind}:${item.id}`);
    setError(null);
    try {
      await sendJson(`/api/time/reference/${kind}/${item.id}`, 'PATCH', patch);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function addItem(kind: TimeReferenceKind) {
    const name = (newName[kind] || '').trim();
    if (!name) return;
    setBusyKey(`${kind}:new`);
    setError(null);
    try {
      await sendJson(`/api/time/reference/${kind}`, 'POST', { name });
      setNewName((prev) => ({ ...prev, [kind]: '' }));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function importFromBlikk() {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sendJson('/api/admin/time/import-from-blikk', 'POST');
      const summary = SECTIONS.map((section) => {
        const counts = result?.[section.kind];
        return `${section.label}: ${counts?.created ?? 0} nya, ${counts?.updated ?? 0} uppdaterade`;
      }).join(' · ');
      setNotice(`Hämtat från Blikk — ${summary}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  if (loading) return <p role="status" className="m-0 p-5 text-sm text-slate-500">Laddar…</p>;

  return (
    <div className="grid gap-4 p-5">
      {error ? (
        <div role="alert" className={ADMIN_ERROR_BOX}>
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-3 underline">Stäng</button>
        </div>
      ) : null}

      {notice ? (
        <div role="status" className={ADMIN_NOTICE_BOX}>
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="ml-3 underline">Stäng</button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid max-w-[720px] gap-1">
          <h2 className="m-0 text-lg font-bold text-slate-900">Tidkoder och referensdata</h2>
          <p className="m-0 text-sm text-slate-600">
            Listorna som tidrapporteringen väljer ur. De hämtas en gång från Blikk och underhålls sedan här —
            efter att Blikk kopplats bort är det här enda stället de finns.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void importFromBlikk()}
          disabled={importing}
          className={crm.ghostButton}
        >
          {importing ? 'Hämtar…' : 'Hämta från Blikk'}
        </button>
      </div>

      {missingPayrollCode > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{missingPayrollCode}</strong> aktiva rader saknar lönesort. Löneunderlaget kan inte placera deras
          timmar förrän fältet är ifyllt — Blikk-importen tar inte med det, det är er byrås benämning.
        </div>
      ) : null}

      {SECTIONS.map((section) => {
        const items = data[section.kind];
        return (
          <section key={section.kind} className="grid gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="m-0 text-base font-bold text-slate-900">{section.label}</h3>
              <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-600 tabular-nums')}>{items.length}</span>
              <span className="text-sm text-slate-500">{section.help}</span>
            </div>

            <div className={cn(ADMIN_CARD, 'overflow-x-auto')}>
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className={cn('border-x-0 border-t-0 border-b border-[#e0e8dc] bg-[#f9fbf7] text-left', ADMIN_COLHEAD)}>
                    <th className="px-3 py-2">Namn</th>
                    <th className="px-3 py-2">Kod</th>
                    <th className="px-3 py-2">Lönesort</th>
                    <th className="px-3 py-2">Kommentar krävs</th>
                    {section.kind === 'time_code' ? <th className="px-3 py-2">Debiterbar</th> : null}
                    <th className="px-3 py-2">Aktiv</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-slate-500">
                        Tomt. Hämta från Blikk, eller lägg till en rad nedan.
                      </td>
                    </tr>
                  ) : null}
                  {items.map((item) => {
                    const busy = busyKey === `${section.kind}:${item.id}`;
                    return (
                      <tr key={item.id} className={cn('border-x-0 border-t-0 border-b border-slate-100', !item.is_active && 'text-slate-500')}>
                        <td className="px-3 py-2 font-medium">
                          {item.name}
                          {item.blikk_id ? <span className="ml-2 text-xs text-slate-500">Blikk #{item.blikk_id}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-slate-500">{item.code || '—'}</td>
                        <td className="px-3 py-2">
                          {/* Sparas på blur, inte per tangenttryck: fältet är fritext och admin skriver
                              av byråns benämning i lugn och ro. */}
                          <input
                            defaultValue={item.payroll_code || ''}
                            onBlur={(e) => {
                              const value = e.target.value.trim();
                              if (value === (item.payroll_code || '')) return;
                              void patchItem(section.kind, item, { payroll_code: value || null });
                            }}
                            placeholder="—"
                            disabled={busy}
                            className={cn(
                              crm.input,
                              'h-8 w-32 px-2',
                              item.is_active && !item.payroll_code && 'border-amber-300 bg-amber-50',
                            )}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={item.requires_note}
                            disabled={busy}
                            onChange={(e) => void patchItem(section.kind, item, { requires_note: e.target.checked })}
                            className={ADMIN_CHECKBOX}
                            aria-label={`Kommentar krävs för ${item.name}`}
                          />
                        </td>
                        {section.kind === 'time_code' ? (
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={item.billable === true}
                              disabled={busy}
                              onChange={(e) => void patchItem(section.kind, item, { billable: e.target.checked })}
                              className={ADMIN_CHECKBOX}
                              aria-label={`Debiterbar: ${item.name}`}
                            />
                          </td>
                        ) : null}
                        <td className="px-3 py-2">
                          {/* Inaktivering i stället för radering: en historisk tidrad får aldrig tappa sin
                              lönesort. Raden försvinner ur formuläret men finns kvar bakom gamla timmar. */}
                          <input
                            type="checkbox"
                            checked={item.is_active}
                            disabled={busy}
                            onChange={(e) => void patchItem(section.kind, item, { is_active: e.target.checked })}
                            className={ADMIN_CHECKBOX}
                            aria-label={`Aktiv: ${item.name}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newName[section.kind] || ''}
                onChange={(e) => setNewName((prev) => ({ ...prev, [section.kind]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void addItem(section.kind); }}
                placeholder={`Ny ${section.label.toLowerCase().replace(/er$/, '')}…`}
                className={cn(crm.input, 'w-64')}
              />
              <button
                type="button"
                onClick={() => void addItem(section.kind)}
                disabled={!((newName[section.kind] || '').trim()) || busyKey === `${section.kind}:new`}
                className={crm.formButton}
                style={{ backgroundColor: 'var(--ek-green)' }}
              >
                Lägg till
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
