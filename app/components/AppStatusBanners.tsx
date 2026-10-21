'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import {
  formatSystemNoticeEnd,
  isSystemNoticeActive,
  systemNoticeDismissKey,
} from '@/lib/domains/systemNotices/notices';
import { systemNoticeAreaLabel, type SystemNoticeKind, type SystemNoticeView } from '@/lib/domains/systemNotices/types';

// Bannern överst i appen: driftmeddelanden som admin slår på (Admin → Driftmeddelanden). Syns för alla inloggade, även
// montörerna i fältvyn. Hämtas var minut medan fliken syns, och direkt när den syns igen — så ett meddelande som slås
// på når de flesta inom en minut, utan att sidan laddas om.
const POLL_MS = 60_000;

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
}: {
  notice: SystemNoticeView;
  now: Date;
  onDismiss?: () => void;
}) {
  const style = KIND_STYLE[notice.kind];
  return (
    <div
      role={notice.kind === 'disruption' ? 'alert' : 'status'}
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

/**
 * `shell` = första elementet i app-skalets innehållsyta, sticky och kant i kant med den (de negativa marginalerna tar ut
 * <main>:s padding). `bare` = sidor utan skal (fältvyn), statiskt överst — fältvyn har egna sticky-rader.
 */
export default function AppStatusBanners({ placement }: { placement: 'shell' | 'bare' }) {
  const [notices, setNotices] = useState<SystemNoticeView[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [now, setNow] = useState(() => new Date());

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
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const visible = notices.filter((n) => isSystemNoticeActive(n, now) && !dismissed.includes(systemNoticeDismissKey(n)));
  if (visible.length === 0) return null;

  const dismiss = (notice: SystemNoticeView) => {
    const key = systemNoticeDismissKey(notice);
    const next = [...dismissed.filter((k) => k !== key), key];
    writeDismissed(next);
    setDismissed(next);
  };

  return (
    <div
      className={cn(
        'grid',
        placement === 'shell' ? 'sticky top-0 z-30 -mx-4 -mt-4 mb-4 lg:-mx-6 lg:-mt-6' : 'relative z-30',
      )}
    >
      {visible.map((notice) => (
        <SystemNoticeStrip key={notice.id} notice={notice} now={now} onDismiss={() => dismiss(notice)} />
      ))}
    </div>
  );
}
