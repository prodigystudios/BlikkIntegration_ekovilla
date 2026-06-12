import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/shared/cn';
import {
  workOrderStatusLabel,
  workOrderStatusClass,
  workOrderStatusAccent,
  type WorkOrderStatus,
} from '@/app/crm/lib/crmTokens';
import type { JobDisplay } from '@/lib/domains/planning/display';
import { sacksRemaining, sacksOverrun } from '@/lib/domains/planning/reports';
import { crewInitials, crewColor, type CrewMember, type AssignablePerson } from '@/lib/domains/planning/crew';
import { describeSmsStatus, type ConfirmationSummary } from '@/lib/domains/planning/confirmations';
import type { JobType } from '@/lib/domains/planning/jobTypes';

// Status label + colors for a job, reusing the CRM work-order tokens so the planning board reads
// identically to the rest of the CRM.
export function statusMeta(status: string) {
  const s = status as WorkOrderStatus;
  return {
    label: workOrderStatusLabel[s] ?? status,
    pill: workOrderStatusClass[s] ?? 'border-slate-200 bg-slate-50 text-slate-600',
    rail: workOrderStatusAccent[s] ?? 'bg-slate-300',
  };
}

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const m = statusMeta(status);
  return (
    <span className={cn('whitespace-nowrap rounded-full border px-2 py-px text-[9px] font-bold', m.pill, className)}>
      {m.label}
    </span>
  );
}

// Planned sack total computed from the work order's line items.
export function SackBadge({ sacks }: { sacks: number }) {
  if (!(sacks > 0)) return null;
  return (
    <span className="whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-px text-[10px] font-bold tabular-nums text-emerald-700">
      {sacks} säck
    </span>
  );
}

// Sack progress: once any sacks are reported as blown it switches to an amber "kvar X / Y" plus
// the blown count; otherwise it shows the planned total.
export function SackProgress({ planned, reported }: { planned: number; reported: number }) {
  if (!(planned > 0) && !(reported > 0)) return null;
  if (reported > 0) {
    const over = sacksOverrun(planned, reported);
    const title = `Blåsta ${reported} av ${planned} planerade säckar`;
    if (over > 0) {
      return (
        <span
          title={title}
          className="whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-2 py-px text-[10px] font-bold tabular-nums text-rose-700"
        >
          över {over} / {planned}
        </span>
      );
    }
    return (
      <span
        title={title}
        className="whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-px text-[10px] font-bold tabular-nums text-amber-700"
      >
        kvar {sacksRemaining(planned, reported)} / {planned}
      </span>
    );
  }
  return <SackBadge sacks={planned} />;
}

export function MaterialChip({ material }: { material: string | null }) {
  if (!material) return null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#e0e8dc] bg-[#f3f6f1] px-2 py-px text-[10px] font-semibold text-slate-600">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {material}
    </span>
  );
}

// The explicit planner-set job type (with its colour, already resolved by the caller) when present;
// otherwise the material inferred from the work order.
export function JobTypeOrMaterial({ jobType, material }: { jobType: { label: string; color: string } | null; material: string | null }) {
  if (!jobType) return <MaterialChip material={material} />;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#e0e8dc] bg-[#f3f6f1] px-2 py-px text-[10px] font-semibold text-slate-600">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: jobType.color }} />
      {jobType.label}
    </span>
  );
}

// Paused-placement marker. Amber so it reads as "needs attention / not active".
export function HoldBadge() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-px text-[9px] font-bold text-amber-700">
      <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
      Pausad
    </span>
  );
}

// Confirmation state: a green "bekräftad" pill once an email and/or SMS has gone out to the
// customer, with the channels + dates + recipients in the tooltip. When Twilio reports the SMS as
// failed/undelivered the pill turns rose so the planner sees the customer wasn't reached. Renders
// nothing until something is sent.
export function ConfirmationBadge({ confirmation }: { confirmation: ConfirmationSummary }) {
  const { email_sent_at, sms_sent_at, email_to, sms_to, sms_status } = confirmation;
  if (!email_sent_at && !sms_sent_at) return null;

  const sms = sms_sent_at ? describeSmsStatus(sms_status) : null;
  const failed = sms?.tone === 'fail';
  const channels = [email_sent_at ? 'Mejl' : null, sms_sent_at ? 'SMS' : null].filter(Boolean).join(' + ');
  const title = [
    email_sent_at && `Mejl ${email_sent_at.slice(0, 10)}${email_to ? ` → ${email_to}` : ''}`,
    sms_sent_at && `SMS ${sms_sent_at.slice(0, 10)}${sms_to ? ` → ${sms_to}` : ''}${sms ? ` (${sms.label})` : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[9px] font-bold',
        failed ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700',
      )}
    >
      {failed ? (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      ) : (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
      {failed ? `${channels} · ej levererat` : channels}
    </span>
  );
}

// A single crew avatar: initials on the person's deterministic colour.
function Avatar({ name, seed, size = 20 }: { name: string; seed: string; size?: number }) {
  return (
    <span
      title={name}
      className="inline-flex items-center justify-center rounded-full font-bold text-white ring-1 ring-black/5"
      style={{ width: size, height: size, fontSize: size <= 16 ? 7 : 8.5, backgroundColor: crewColor(seed) }}
    >
      {crewInitials(name)}
    </span>
  );
}

// Read-only crew cluster (overlapping avatars) — used where the board isn't editable.
export function CrewAvatars({ crew, size }: { crew: CrewMember[]; size?: number }) {
  if (crew.length === 0) return null;
  return (
    <div className="flex items-center -space-x-1.5">
      {crew.map((c) => (
        <Avatar key={c.id} name={c.member_name} seed={c.member_id ?? c.member_name} size={size} />
      ))}
    </div>
  );
}

// Editable crew row: removable avatars + a "+ team" dropdown of assignable people. All clicks are
// stopped so they don't bubble to the card's open-work-order handler.
export function CrewEditor({
  crew,
  people,
  onAdd,
  onRemove,
}: {
  crew: CrewMember[];
  people: AssignablePerson[];
  onAdd: (person: AssignablePerson) => void;
  onRemove: (memberId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  const assigned = new Set(crew.map((c) => c.member_id));
  const available = people.filter((p) => !assigned.has(p.id));

  return (
    <div className="flex flex-wrap items-center gap-1" onClick={stop} onMouseDown={stop}>
      {crew.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={(e) => {
            stop(e);
            if (c.member_id) onRemove(c.member_id);
          }}
          title={`${c.member_name} — klicka för att ta bort`}
          className="group/av relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[8.5px] font-bold text-white ring-1 ring-black/5"
          style={{ backgroundColor: crewColor(c.member_id ?? c.member_name) }}
        >
          <span className="group-hover/av:opacity-0">{crewInitials(c.member_name)}</span>
          <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-rose-500 text-[11px] leading-none group-hover/av:flex">×</span>
        </button>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            setOpen((o) => !o);
          }}
          className="inline-flex h-5 items-center rounded-full border border-dashed border-[#c8d4c3] bg-white px-1.5 text-[9px] font-bold text-slate-400 transition hover:border-emerald-400 hover:text-emerald-600"
        >
          + team
        </button>
        {open && (
          <>
            <span className="fixed inset-0 z-10" onClick={(e) => { stop(e); setOpen(false); }} />
            <div className="absolute left-0 top-6 z-20 max-h-52 w-44 overflow-auto rounded-xl border border-[#e0e8dc] bg-white p-1 shadow-lg">
              {available.length === 0 ? (
                <p className="px-2 py-1.5 text-[10px] text-slate-400">Alla tillagda</p>
              ) : (
                available.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={(e) => {
                      stop(e);
                      onAdd(p);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-slate-700 transition hover:bg-emerald-50"
                  >
                    <Avatar name={p.full_name} seed={p.id} size={18} />
                    <span className="truncate">{p.full_name}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// A small pin link opening the job-site address in Google Maps. Stops propagation so it doesn't
// trigger the card's select/open handler.
export function MapLink({ address }: { address: string | null }) {
  if (!address) return null;
  const href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Öppna i Kartor"
      aria-label="Öppna adressen i Kartor"
      className="inline-flex shrink-0 text-slate-400 transition hover:text-emerald-600"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    </a>
  );
}

// The reference shown on cards (Fortnox number, or internal AO when not synced yet).
export function JobRef({ job, className }: { job: Pick<JobDisplay, 'ref' | 'is_fortnox_ref'>; className?: string }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap text-[12px] font-extrabold tabular-nums tracking-tight',
        job.is_fortnox_ref ? 'text-[#1f4a2e]' : 'font-bold text-slate-400',
        className,
      )}
    >
      {job.ref}
    </span>
  );
}

// Per-segment actions, tucked behind a kebab so the card itself stays calm (matching the mockup):
// set/clear the job type, pause/resume, and send an order confirmation. The popover is portalled to
// <body> so it escapes the card's overflow-hidden / transform clipping; it closes on outside click,
// scroll, or resize.
export function SegmentMenu({
  jobType,
  jobTypes,
  onHold,
  lengthDays,
  onSetJobType,
  onToggleHold,
  onOpenConfirm,
  onSetLength,
}: {
  jobType: string | null;
  jobTypes: JobType[];
  onHold: boolean;
  lengthDays: number;
  onSetJobType: (key: string | null) => void;
  onToggleHold: () => void;
  onOpenConfirm: () => void;
  onSetLength: (days: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = (e: SyntheticEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 204, window.innerWidth - 212)) });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={toggle}
        title="Åtgärder"
        aria-label="Åtgärder"
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg p-0 transition',
          open ? 'bg-slate-100 text-slate-600' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-600',
        )}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onMouseDown={(e) => { e.stopPropagation(); setOpen(false); }} />
            <div
              className="fixed z-[61] w-[204px] rounded-xl border border-[#e0e8dc] bg-white p-1.5 shadow-[0_10px_30px_rgba(20,44,27,0.2)]"
              style={{ top: pos.top, left: pos.left }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="px-1.5 pb-1 pt-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">Jobbtyp</p>
              <div className="grid grid-cols-2 gap-1">
                {jobTypes.map((t) => {
                  const active = t.key === jobType;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        onSetJobType(active ? null : t.key);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[10.5px] font-semibold transition',
                        active ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                      <span className="truncate">{t.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="my-1.5 h-px bg-[#eef3eb]" />

              <p className="px-1.5 pb-1 pt-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">Längd (dagar)</p>
              <div className="flex gap-1 px-0.5">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      onSetLength(d);
                      setOpen(false);
                    }}
                    className={cn(
                      'h-6 flex-1 rounded-lg p-0 text-[11px] font-bold tabular-nums transition',
                      d === lengthDays ? 'bg-emerald-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>

              <div className="my-1.5 h-px bg-[#eef3eb]" />

              <button
                type="button"
                onClick={() => {
                  onToggleHold();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                {onHold ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                )}
                {onHold ? 'Återuppta' : 'Pausa'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenConfirm();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[11px] font-semibold text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-700"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M22 7l-10 6L2 7" />
                </svg>
                Skicka bekräftelse
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
