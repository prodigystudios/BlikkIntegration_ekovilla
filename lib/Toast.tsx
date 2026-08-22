"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';

type ToastKind = 'success' | 'error' | 'info';
type ToastOptions = { ttl?: number; title?: string };
type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
  title?: string;
  ttl: number;
  /** Satt av kapningen nedan: notisen ska stänga nu, oavsett hur mycket tid den hade kvar. */
  expiring?: boolean;
};

type ToastContextValue = {
  push: (kind: ToastKind, message: string, opts?: ToastOptions) => void;
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

// Fler än så på skärmen samtidigt går ändå inte att läsa innan de hinner rinna ut,
// och en obegränsad stack kan täcka hela högerkanten. Äldst ryker först.
const MAX_VISIBLE = 4;

// Ut-animationens längd. Måste hållas i synk med .crm-toast-out i globals.css.
const EXIT_MS = 180;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: string) => {
    setItems(list => list.filter(t => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string, opts?: ToastOptions) => {
    const ttl = Math.max(1500, Math.min(10_000, opts?.ttl ?? (kind === 'error' ? 5000 : 2500)));
    seq.current += 1;
    const id = `toast-${seq.current}`;
    setItems(list => {
      const next = [...list, { id, kind, message, title: opts?.title, ttl }];
      // Kapa mjukt: de äldsta får stänga på vanligt sätt (ut-animation, samma
      // borttagningsväg) i stället för att ryckas ur listan mitt i visningen.
      const overflow = next.length - MAX_VISIBLE;
      return overflow > 0 ? next.map((t, i) => (i < overflow ? { ...t, expiring: true } : t)) : next;
    });
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    push,
    success: (m, o) => push('success', m, o),
    error: (m, o) => push('error', m, o),
    info: (m, o) => push('info', m, o),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onClose={remove} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ── Ton per notistyp ────────────────────────────────────────────────────────
// Notisen bär CRM-kortets papper (#f9fbf7), inte vitt — samma skäl som CrmModal
// anger för sin yta: den ska höra ihop med appen den svävar över. Färgen sitter
// i stället i accentskenan och ikonrundeln, precis som listraderna i CRM:et
// (workOrderStatusAccent) redan använder en solid vänsterskena för snabbavläsning.
//
// Info bär husets dämpade sage, inte den generiska blå — blå är upptagen i CRM:et
// (sky = "Skickad" / "Pågående") och skulle läsas som en status.
const TONE: Record<ToastKind, { rail: string; iconWrap: string; icon: ReactNode }> = {
  success: {
    rail: 'bg-emerald-500',
    iconWrap: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: <polyline points="20 6 9 17 4 12" />,
  },
  error: {
    rail: 'bg-rose-500',
    iconWrap: 'border-rose-200 bg-rose-50 text-rose-600',
    // Utropstecken: streck över, punkt under.
    icon: <><path d="M12 7v6" /><path d="M12 17h.01" /></>,
  },
  info: {
    rail: 'bg-[#5b7a63]',
    iconWrap: 'border-[#d5e0d0] bg-[#eef3ec] text-[#33503c]',
    // Gemena i: punkt över, streck under — spegelvänt mot felikonen.
    icon: <><path d="M12 7h.01" /><path d="M12 11v6" /></>,
  },
};

function ToastViewport({ items, onClose }: { items: ToastItem[]; onClose: (id: string) => void }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      // z-[4000] med flit: notisen ska ligga över ALLT annat, annars är den
      // meningslös. Skalan i appen i dag: CrmModal/QuoteDetailPanel 2800,
      // NotificationBell/DocumentEmailProgress 2900, ProfileMenu 3000,
      // planeringens bekräftelser 3050. Toasten låg på 2000 och hamnade därför
      // bakom både tinten och panelen så fort en modal var uppe. Höj den här om
      // något någonsin läggs högre — sänk inte notisen.
      //
      // pointer-events-none på ytan: containern är ett brett fixed fält uppe till
      // höger och får inte äta klick på sidan under. Korten slår på det igen.
      className={cn(
        'pointer-events-none fixed inset-x-3 z-[4000] grid gap-2',
        // Två olika brytpunkter med flit. BREDDEN följer skärmen (sm): full bredd
        // på telefon, 380 px i högerkanten därifrån. TOPPEN följer skalet (lg):
        // under lg renderar AppSidebar en mobiltopbar på safe-area + 60 px, och
        // den bär notisklockan och hamburgaren i just det hörn notisen landar i.
        // Ligger notisen ovanpå dem äter den tapsen så länge den syns. 4.25rem
        // lämnar 8 px luft under baren; från lg finns ingen bar att väja för.
        '[top:calc(env(safe-area-inset-top)+4.25rem)]',
        'sm:left-auto sm:right-4 sm:w-[380px]',
        'lg:[top:1rem]',
      )}
    >
      {items.map(t => (
        <ToastCard key={t.id} item={t} onClose={onClose} />
      ))}
    </div>
  );
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const [closing, setClosing] = useState(false);
  const remainingRef = useRef(item.ttl);
  const tone = TONE[item.kind];

  // Nedräkningen. Pausen skriver tillbaka återstående tid i städfunktionen, så
  // JS-timern och timerbarens CSS-animation håller sig i synk över hur många
  // paus/återupptag som helst.
  useEffect(() => {
    if (paused || closing) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => setClosing(true), remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [paused, closing]);

  // Kapningen i providern begär stängning; kortet stänger sig som vanligt.
  useEffect(() => {
    if (item.expiring) setClosing(true);
  }, [item.expiring]);

  // Ut-animationen äger borttagningen ur listan.
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => onClose(item.id), EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing, item.id, onClose]);

  return (
    <div
      // role="alert" på fel ger dem företräde hos skärmläsare; övriga läses upp
      // av containerns aria-live="polite".
      role={item.kind === 'error' ? 'alert' : 'status'}
      // Pausen är ett tillgänglighetskrav (WCAG 2.2.1) och inte bara bekvämlighet:
      // en 2,5-sekundersnotis måste gå att hålla kvar. Men den får BARA hänga på
      // riktig hover. Touch syntetiserar mouseenter vid tap och skickar mouseleave
      // först vid nästa tap någon annanstans — med onMouseEnter blev en tap på
      // notisen liktydigt med att pinna den på skärmen tills vidare.
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setPaused(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setPaused(false); }}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        closing ? 'crm-toast-out' : 'crm-toast-in',
        'pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl',
        'border border-solid border-[#e0e8dc] bg-[#f9fbf7] py-3 pl-4 pr-2.5',
        'shadow-[0_1px_3px_rgba(20,44,27,0.08),0_18px_40px_-12px_rgba(20,44,27,0.35)]',
      )}
    >
      {/* Accentskenan — samma gest som listradernas vänsterskena i CRM:et. */}
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-[3px]', tone.rail)} />

      <span
        aria-hidden="true"
        className={cn('mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-solid', tone.iconWrap)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          {tone.icon}
        </svg>
      </span>

      <div className="min-w-0 flex-1 pb-0.5">
        {item.title ? (
          <>
            <div className="text-[13px] font-bold leading-snug tracking-tight text-slate-900">{item.title}</div>
            <div className="mt-0.5 text-[13px] leading-snug text-slate-600">{item.message}</div>
          </>
        ) : (
          <div className="text-[13px] font-semibold leading-snug text-slate-800">{item.message}</div>
        )}
      </div>

      <button
        type="button"
        aria-label="Stäng notis"
        onClick={() => setClosing(true)}
        className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-solid border-transparent bg-transparent p-0 text-slate-400 transition hover:border-slate-200 hover:bg-white hover:text-slate-700"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>

      {/* Timerbaren: rinner tillbaka in i accentskenan och möter den i hörnet.
          Pausas i takt med nedräkningen ovan. */}
      <span
        aria-hidden="true"
        className={cn('crm-toast-timer absolute inset-x-0 bottom-0 h-[3px]', tone.rail)}
        style={{
          animationDuration: `${item.ttl}ms`,
          animationPlayState: paused || closing ? 'paused' : 'running',
        }}
      />
    </div>
  );
}
