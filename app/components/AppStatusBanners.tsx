'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import {
  formatSystemNoticeEnd,
  isSystemNoticeActive,
  systemNoticeDismissKey,
} from '@/lib/domains/systemNotices/notices';
import { systemNoticeAreaLabel, type SystemNoticeKind, type SystemNoticeView } from '@/lib/domains/systemNotices/types';
import { APP_BUILD_ID, isOtherAppVersionLive } from '@/lib/domains/systemNotices/appVersion';

// Bannern överst i appen: driftmeddelanden som admin slår på (Admin → Driftmeddelanden). Syns för alla inloggade, även
// montörerna i fältvyn. Hämtas var minut medan fliken syns, och direkt när den syns igen — så ett meddelande som slås
// på når de flesta inom en minut, utan att sidan laddas om.
const POLL_MS = 60_000;

// Admin-fliken skickar den här efter varje ändring, så att den som slog på meddelandet ser det direkt i sin egen flik
// i stället för vid nästa minut. Alla andra får det vid sin nästa hämtning.
export const APP_STATUS_REFRESH_EVENT = 'app-status:refresh';

// Stängda meddelanden, per webbläsare. Nyckeln bär meddelandets version (systemNoticeDismissKey), så en ändrad text
// visas igen. Taket håller listan liten; de äldsta faller bort först.
const DISMISSED_STORAGE_KEY = 'systemNotices.dismissed';
const DISMISSED_MAX = 50;

function readDismissed(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissed(keys: string[]) {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(keys.slice(-DISMISSED_MAX)));
  } catch {
    // Privat läge eller blockerad lagring: stängningen gäller bara den här sidvisningen.
  }
}

// Lugnt för allt utom störningen. Den pulserande punkten betyder "pågår nu" och finns bara där något faktiskt pågår.
const KIND_STYLE: Record<SystemNoticeKind, { strip: string; rail: string; dot: string; chip: string; live: boolean }> = {
  info: {
    strip: 'border-[#d5e0cf] bg-[#f1f5ee]',
    rail: 'bg-[color:var(--ek-accent)]',
    dot: 'bg-[color:var(--ek-accent)]',
    chip: 'border-[#c6dccd] text-[#24553a]',
    live: false,
  },
  maintenance: {
    strip: 'border-[#e3d8bd] bg-[#f6f2e6]',
    rail: 'bg-[#9a7a2b]',
    dot: 'bg-[#9a7a2b]',
    chip: 'border-[#ddcfa9] text-[#6b5419]',
    live: false,
  },
  update: {
    strip: 'border-[#ead6a4] bg-[#faf3e1]',
    rail: 'bg-[#b7801b]',
    dot: 'bg-[#b7801b]',
    chip: 'border-[#e4cc90] text-[#71500f]',
    live: true,
  },
  disruption: {
    strip: 'border-[#efc6c6] bg-[#fbefef]',
    rail: 'bg-[#b4233c]',
    dot: 'bg-[#b4233c]',
    chip: 'border-[#ebbcc3] text-[#8b1a2f]',
    live: true,
  },
};

export function SystemNoticeStrip({
  notice,
  now,
  onDismiss,
  announce = true,
}: {
  notice: SystemNoticeView;
  now: Date;
  onDismiss?: () => void;
  // false = ingen live-region. Admin-flikens förhandsvisning ändras vid varje tangenttryck och hade lästs upp varje gång.
  announce?: boolean;
}) {
  const style = KIND_STYLE[notice.kind];
  return (
    <div
      role={announce ? (notice.kind === 'disruption' ? 'alert' : 'status') : undefined}
      className={cn('relative flex items-start gap-2 border-b py-2 pl-4 pr-1 text-slate-800', style.strip)}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', style.rail)} />
      <div className="grid min-w-0 flex-1 gap-1 py-1">
        <p className="m-0 text-[13px] leading-snug">
          <span className="mr-2 inline-flex items-center gap-1.5 font-semibold">
            <span
              aria-hidden
              className={cn('inline-block h-2 w-2 shrink-0 rounded-full', style.dot, style.live && 'motion-safe:animate-pulse')}
            />
            {notice.kind_label}
          </span>
          <span className="whitespace-pre-line">{notice.message}</span>
        </p>
        {notice.areas.length > 0 || notice.ends_at ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-600">
            {notice.areas.length > 0 ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                <span className="mr-0.5">Påverkar</span>
                {notice.areas.map((area) => (
                  <span key={area} className={cn('rounded-md border px-1.5 py-px font-medium', style.chip)}>
                    {systemNoticeAreaLabel[area]}
                  </span>
                ))}
              </span>
            ) : null}
            {notice.ends_at ? <span>Beräknas klart {formatSystemNoticeEnd(notice.ends_at, now)}</span> : null}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dölj meddelandet"
          title="Dölj tills meddelandet ändras"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-lg leading-none text-slate-500 transition hover:bg-black/5 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent)]"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

// "Appen har uppdaterats": servern kör en annan version än flikens kod. Lugn som informationen — det är inget fel, bara
// ett erbjudande. Omladdningen frågar först om sidan har osparade ändringar (useLeaveGuard lyssnar på beforeunload).
export function AppUpdatedStrip({ onReload, onLater }: { onReload: () => void; onLater: () => void }) {
  const style = KIND_STYLE.info;
  return (
    <div role="status" className={cn('relative flex items-start gap-2 border-b py-2 pl-4 pr-1 text-slate-800', style.strip)}>
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', style.rail)} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 py-1">
        <p className="m-0 min-w-0 flex-1 basis-64 text-[13px] leading-snug">
          <span className="mr-2 inline-flex items-center gap-1.5 font-semibold">
            <span aria-hidden className={cn('inline-block h-2 w-2 shrink-0 rounded-full', style.dot)} />
            Appen har uppdaterats
          </span>
          <span>Spara det du håller på med och ladda om sidan för att få den senaste versionen.</span>
        </p>
        <button
          type="button"
          onClick={onReload}
          className="inline-flex h-9 shrink-0 items-center rounded-lg bg-[color:var(--ek-green)] px-3 text-[13px] font-semibold text-white transition hover:bg-[color:var(--ek-green-strong)] focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent)] focus-visible:ring-offset-2"
        >
          Ladda om
        </button>
      </div>
      <button
        type="button"
        onClick={onLater}
        aria-label="Påminn mig senare"
        title="Döljs tills nästa uppdatering"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-lg leading-none text-slate-500 transition hover:bg-black/5 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent)]"
      >
        ×
      </button>
    </div>
  );
}

/**
 * `className` kommer från app-skalet, som äger måtten (se BANNER_BLEED i AppShell.tsx). Rullar med sidan, med flit:
 * sticky räknar `top` från innehållsytan innanför paddingen och lade bannern över sidans rubrik, och två meddelanden
 * tog en tredjedel av en mobilskärm hela tiden. Den som läst stänger det.
 *
 * Bannern dyker upp efter första hämtningen och skjuter då sidan nedåt. Det sker bara när ett meddelande är på, och
 * att hämta det i rotlayouten hade kostat en databasfråga per sidvisning för alla, varje dag.
 */
export default function AppStatusBanners({ className }: { className?: string }) {
  const [notices, setNotices] = useState<SystemNoticeView[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [now, setNow] = useState(() => new Date());
  // Serverns version och den som "Senare" gällde. Bara i minnet: en omladdning ger ändå den nya koden, och skalet ligger
  // kvar över klientnavigeringar, så "Senare" håller tills nästa driftsättning.
  const [liveBuild, setLiveBuild] = useState<string | null>(null);
  const [postponedBuild, setPostponedBuild] = useState<string | null>(null);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      // Klockan går även när hämtningen misslyckas, så ett meddelande vars sluttid passerat försvinner ändå.
      setNow(new Date());
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch('/api/app-status', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
        // Ett misslyckat svar behåller det som visas: en tillfällig miss ska inte blinka bort en banner.
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        if (cancelled || !body?.ok) return;
        setNotices((body.data?.notices ?? []) as SystemNoticeView[]);
        setLiveBuild(typeof body.data?.build === 'string' ? body.data.build : null);
      } catch {
        // Nätfel eller avbrutet: nästa tick försöker igen.
      }
    };

    load();
    const timer = window.setInterval(load, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(APP_STATUS_REFRESH_EVENT, load);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(APP_STATUS_REFRESH_EVENT, load);
    };
  }, []);

  const visible = notices.filter((n) => isSystemNoticeActive(n, now) && !dismissed.includes(systemNoticeDismissKey(n)));
  const showUpdate = isOtherAppVersionLive(APP_BUILD_ID, liveBuild) && postponedBuild !== liveBuild;
  if (visible.length === 0 && !showUpdate) return null;

  const dismiss = (notice: SystemNoticeView) => {
    const key = systemNoticeDismissKey(notice);
    const next = [...dismissed.filter((k) => k !== key), key];
    writeDismissed(next);
    setDismissed(next);
  };

  return (
    <div className={cn('grid', className)}>
      {visible.map((notice) => (
        <SystemNoticeStrip key={notice.id} notice={notice} now={now} onDismiss={() => dismiss(notice)} />
      ))}
      {showUpdate ? (
        <AppUpdatedStrip onReload={() => window.location.reload()} onLater={() => setPostponedBuild(liveBuild)} />
      ) : null}
    </div>
  );
}
