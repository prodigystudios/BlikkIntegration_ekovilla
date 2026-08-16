"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { ticketKindGlyph, ticketKindGlyphClass, ticketStatusMeta } from '@/app/_lib/supportTokens';
import { guessAreaFromPath } from '@/lib/domains/support/areas';
import {
  TICKET_AREAS,
  TICKET_KINDS,
  areaLabel,
  kindLabel,
  type AppTicketView,
  type TicketArea,
  type TicketKind,
} from '@/lib/domains/support/types';

// Rapportera-knappen: nås från varje sida i appen, förifylld med var användaren stod.
//
// VARFÖR EN MÄRKT PILL OCH INTE EN RUND IKONKNAPP. Den som ska rapportera en bugg mitt i ett jobb
// har handskar på sig och har aldrig letat efter den här knappen förut. En cirkel med ett tecken i
// kräver att man redan vet vad den gör; ordet gör det inte. På telefon krymper den till tecken +
// kort ord så den inte lägger sig över innehållet.
//
// Ytor där den INTE ska finnas: inloggningen (ingen användare att rapportera som) och kundens
// signeringssida (en extern kund ska inte se företagets interna supportformulär). Fältvyn
// /arbetsorder saknar sidomeny men ÄR en inloggad yta — installatörerna är de som ser flest buggar,
// så knappen ska finnas där. Därför renderas komponenten utanför AppShell (i root-layouten),
// bredvid InstallPrompt.
const HIDDEN_PREFIXES = ['/auth', '/kund/offert'];

function isHiddenPath(pathname: string) {
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

type Panel = 'form' | 'mine';

export default function ReportIssueLauncher({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('form');

  if (!loggedIn || isHiddenPath(pathname)) return null;

  return (
    // Två klasser, båda för att komponenten med flit renderas UTANFÖR AppShell (fältvyn saknar skal):
    //
    // `crm-shell` bär CRM:ets CSS-variabler, och de är scopade till DEN klassen — inte till :root.
    // Utan den var `var(--crm-primary)` odefinierad och Skicka-knappen blev vit text på ingen
    // bakgrund: osynlig.
    //
    // Div:en är layoutneutral: allt inuti är `fixed`.
    <div className="crm-shell">
      <button
        type="button"
        onClick={() => {
          setPanel('form');
          setOpen(true);
        }}
        aria-label="Rapportera ett problem eller önska en funktion"
        className={cn(
          // z-[25] med flit: knappen är app-krom och ska ALDRIG ligga över sidans egna kontroller.
          // Offertformuläret har en fixerad spar-rad i mobil på z-30, sidomenyns overlay ligger på
          // z-40 och varje dialog högre än så — alla täcker därmed knappen i stället för att täckas
          // av den. Samma regel gäller automatiskt för framtida bottenrader: de vinner.
          'fixed right-3 z-[25] inline-flex items-center gap-2 rounded-full border border-[#cfdcc9] bg-white/95',
          'px-3 py-2 text-[13px] font-semibold text-slate-700 shadow-[0_6px_20px_rgba(20,44,27,0.18)] backdrop-blur',
          'transition hover:border-emerald-300 hover:text-emerald-800 active:scale-[0.98]',
          'bottom-[calc(0.75rem+env(safe-area-inset-bottom))]',
        )}
      >
        <span
          aria-hidden
          className="grid h-5 w-5 place-items-center rounded-full bg-[#e4efe0] text-[12px] font-bold text-emerald-800"
        >
          ?
        </span>
        Rapportera
      </button>

      {open && (
        <ReportModal
          panel={panel}
          setPanel={setPanel}
          pagePath={pathname}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function ReportModal({
  panel,
  setPanel,
  pagePath,
  onClose,
}: {
  panel: Panel;
  setPanel: (p: Panel) => void;
  pagePath: string;
  onClose: () => void;
}) {
  const [reloadToken, setReloadToken] = useState(0);

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Rapportera till appen"
      maxWidth="sm:max-w-[560px]"
      header={
        <div className="grid gap-2">
          <div className="grid gap-0.5">
            <h2 className="m-0 text-base font-bold text-slate-900">Rapportera</h2>
            <p className="m-0 text-[12px] text-slate-500">
              Buggar och önskemål om appen. Det du skickar hamnar i utvecklarens lista.
            </p>
          </div>
          <div role="tablist" aria-label="Rapportera" className="flex gap-2">
            <PanelTab active={panel === 'form'} onClick={() => setPanel('form')}>
              Ny rapport
            </PanelTab>
            <PanelTab active={panel === 'mine'} onClick={() => setPanel('mine')}>
              Mina rapporter
            </PanelTab>
          </div>
        </div>
      }
    >
      {panel === 'form' ? (
        <TicketForm
          pagePath={pagePath}
          onCreated={() => {
            setPanel('mine');
            setReloadToken((t) => t + 1);
          }}
        />
      ) : (
        <MyTickets reloadToken={reloadToken} />
      )}
    </CrmModal>
  );
}

function PanelTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
        active
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-[#e0e8dc] bg-white text-slate-600 hover:border-emerald-200',
      )}
    >
      {children}
    </button>
  );
}

function TicketForm({ pagePath, onCreated }: { pagePath: string; onCreated: () => void }) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [kind, setKind] = useState<TicketKind>('bug');
  const [area, setArea] = useState<TicketArea>(() => guessAreaFromPath(pagePath));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Förhandsvisningen är en blob-URL — den måste återkallas, annars läcker bilden minne så länge
  // fliken lever.
  useEffect(() => {
    if (!screenshot) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(screenshot);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  const clearScreenshot = () => {
    setScreenshot(null);
    // Nollställ även inputen, annars kan samma fil inte väljas igen (ingen change-händelse).
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Skriv en kort rubrik.');
      return;
    }
    if (!description.trim()) {
      setError('Beskriv vad som händer.');
      return;
    }

    setSubmitting(true);
    try {
      // FormData, inte JSON: skärmbilden går som binär del i stället för base64 (som hade svällt
      // kroppen ~33 %).
      const form = new FormData();
      form.set('kind', kind);
      form.set('area', area);
      form.set('title', title.trim());
      form.set('description', description.trim());
      form.set('page_path', pagePath);
      if (screenshot) form.set('screenshot', screenshot);

      const res = await fetch('/api/support/tickets', { method: 'POST', body: form });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || 'Kunde inte skicka rapporten.');

      toast.success('Rapporten är skickad.');
      setTitle('');
      setDescription('');
      clearScreenshot();
      // Före onCreated(): den byter panel och avmonterar det här formuläret, så en setState efteråt
      // skulle träffa en komponent som inte finns kvar.
      setSubmitting(false);
      onCreated();
    } catch (err: any) {
      setError(err?.message || 'Kunde inte skicka rapporten.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <span className={crm.label}>Vad gäller det?</span>
        {/* Två alternativ → segmenterat val i stället för en <select>. Ett tryck i stället för
            tre, och båda alternativen syns utan att öppna något. */}
        <div className="grid grid-cols-2 gap-2">
          {TICKET_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              disabled={submitting}
              className={cn(
                'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border text-[13px] font-semibold transition-colors',
                kind === k
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-[#dce4d8] bg-white text-slate-600 hover:border-[#c8d4c3]',
              )}
            >
              <span
                aria-hidden
                className={cn('grid h-5 w-5 place-items-center rounded-full text-[12px] font-bold', ticketKindGlyphClass[k])}
              >
                {ticketKindGlyph[k]}
              </span>
              {kindLabel[k]}
            </button>
          ))}
        </div>
        <p className="m-0 text-[12px] text-slate-500">
          {kind === 'bug' ? 'Något fungerar inte som det ska.' : 'Något du vill kunna göra i appen.'}
        </p>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="ticket-area" className={crm.label}>Var i appen?</label>
        <Select
          id="ticket-area"
          value={area}
          onChange={(e) => setArea(e.target.value as TicketArea)}
          disabled={submitting}
        >
          {TICKET_AREAS.map((a) => (
            <option key={a} value={a}>{areaLabel[a]}</option>
          ))}
        </Select>
        {/* Sidan användaren står på. Visas för att den skickas med — och för att den ofta är mer
            exakt än vald del av appen. Monospace: det är en adress, inte en mening. */}
        <p className="m-0 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
          Skickas med:
          <code className="rounded border border-[#dce4d8] bg-[#f4f8f1] px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
            {pagePath}
          </code>
        </p>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="ticket-title" className={crm.label}>Rubrik</label>
        <Input
          id="ticket-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === 'bug' ? 'T.ex. Offerten sparar inte' : 'T.ex. Sök på ordernummer'}
          maxLength={120}
          disabled={submitting}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="ticket-description" className={crm.label}>
          {kind === 'bug' ? 'Vad händer?' : 'Vad vill du kunna göra?'}
        </label>
        <Textarea
          id="ticket-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            kind === 'bug'
              ? 'Vad gjorde du, och vad hände i stället för det du väntade dig?'
              : 'Beskriv vad du vill kunna göra, och varför.'
          }
          maxLength={4000}
          disabled={submitting}
        />
      </div>

      <div className="grid gap-1.5">
        <span className={crm.label}>Skärmbild (frivilligt)</span>
        {previewUrl ? (
          <div className="grid gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- lokal blob-URL, inte en
                optimerbar remote-bild */}
            <img
              src={previewUrl}
              alt="Förhandsvisning av vald skärmbild"
              className="max-h-56 w-full rounded-lg border border-[#dce4d8] bg-white object-contain"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[12px] text-slate-500">{screenshot?.name}</span>
              <button
                type="button"
                onClick={clearScreenshot}
                disabled={submitting}
                className={cn(crm.ghostButton, 'shrink-0')}
              >
                Ta bort
              </button>
            </div>
          </div>
        ) : (
          <label
            htmlFor="ticket-screenshot"
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-[#cfdcc9] bg-[#f4f8f1] px-3 text-[13px] font-semibold text-slate-600 transition-colors hover:border-emerald-300 hover:text-emerald-800"
          >
            Välj en bild
          </label>
        )}
        <input
          ref={fileInputRef}
          id="ticket-screenshot"
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={submitting}
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setError(null);
            if (file && file.size > 10 * 1024 * 1024) {
              setError('Skärmbilden är för stor (max 10 MB).');
              clearScreenshot();
              return;
            }
            setScreenshot(file);
          }}
        />
      </div>

      {error && <p className="m-0 text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className={cn(crm.formButton, 'w-full')}
        // Fallback-färgen är ingen dekoration: knappen har vit text, så en odefinierad
        // `--crm-primary` gör den helt osynlig. Variabeln är scopad till `.crm-shell`, och den här
        // komponenten lever utanför AppShell — händelseförloppet som gjorde knappen osynlig en
        // gång. Wrappern ovan löser det, fallbacken gör att det inte kan hända igen.
        style={{ backgroundColor: 'var(--crm-primary, #1a3f26)' }}
      >
        {submitting ? 'Skickar…' : 'Skicka rapport'}
      </button>
    </form>
  );
}

function MyTickets({ reloadToken }: { reloadToken: number }) {
  const [items, setItems] = useState<AppTicketView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/support/tickets?scope=mine', { cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || 'Kunde inte hämta dina rapporter.');
      setItems((j?.data?.items || []) as AppTicketView[]);
    } catch (err: any) {
      setError(err?.message || 'Kunde inte hämta dina rapporter.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadToken]);

  if (loading) return <p className="m-0 text-sm text-slate-500">Laddar…</p>;
  if (error) return <p className="m-0 text-sm text-red-700">{error}</p>;
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#d5e0cf] bg-[#f4f8f1] px-4 py-8 text-center">
        <p className="m-0 text-sm text-slate-500">
          Du har inte rapporterat något än. Hittar du en bugg eller saknar något — skriv det här.
        </p>
      </div>
    );
  }

  return (
    <ul role="list" className="m-0 grid list-none gap-1 p-0">
      {items.map((t) => {
        const expanded = expandedId === t.id;
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : t.id)}
              aria-expanded={expanded}
              className="flex w-full items-stretch overflow-hidden rounded-lg border border-[#e0e8dc] bg-white text-left transition-colors hover:border-[#cfdcc9]"
            >
              <span className={cn('w-1.5 shrink-0', ticketStatusMeta[t.status].accent)} aria-hidden />
              <span className="grid flex-1 gap-0.5 px-3 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-bold text-slate-900">{t.title}</span>
                  <span className={cn(crm.badge, ticketStatusMeta[t.status].badge)}>{t.status_label}</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  {t.kind_label} · {t.area_label} · {formatDate(t.created_at)}
                </span>
                {expanded && (
                  <span className="mt-1 grid gap-2 border-t border-slate-100 pt-2">
                    <span className="whitespace-pre-wrap text-[12px] text-slate-700">{t.description}</span>
                    {t.resolution && (
                      <span className="grid gap-0.5 rounded-lg border border-[#e0e8dc] bg-[#f9fbf7] px-2.5 py-2">
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Svar</span>
                        <span className="whitespace-pre-wrap text-[12px] text-slate-700">{t.resolution}</span>
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
