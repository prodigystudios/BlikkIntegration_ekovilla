"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate } from '@/app/crm/lib/format';
import type { SafetyRoundListRow } from '@/lib/domains/safetyRounds/types';
import { ROUND_STATUS_BADGE, ROUND_STATUS_LABEL } from '@/app/skyddsrond/_components/safetyUi';
import { useStartSafetyRound } from '@/app/skyddsrond/_components/useStartSafetyRound';

// Skyddsronderna på EN arbetsorder — kontorsvyns sidokolumn och fältvyns info-flik.
//
// Ritas BARA för den som har en skyddsrondsnyckel (`visible`, som sidan läser på servern). Utan
// villkoret hade varje installatör och varje ekonomiläsare gjort ett anrop som alltid svarar 403.
// Knappen "Starta skyddsrond" följer SERVERNS svar (`can_write`), inte sidans gissning.
//
// Ett utkast som redan finns lyfts fram som "Fortsätt": en påbörjad rond ska fyllas i klart, inte få
// en tvilling. Att starta en till går ändå — två ronder samma vecka på ett stort jobb är normalt.

type Props = {
  workOrderId: string;
  visible: boolean;
};

export default function WorkOrderSafetyRoundsCard({ workOrderId, visible }: Props) {
  const [rounds, setRounds] = useState<SafetyRoundListRow[]>([]);
  const [openActions, setOpenActions] = useState<number | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { start, startingFor } = useStartSafetyRound();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/safety-rounds?work_order_id=${encodeURIComponent(workOrderId)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setLoadError(true);
        return;
      }
      setRounds((json.data?.items || []) as SafetyRoundListRow[]);
      setOpenActions(typeof json.data?.open_actions === 'number' ? json.data.open_actions : null);
      setCanWrite(json.data?.can_write === true);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [workOrderId]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  if (!visible) return null;

  const draft = rounds.find((round) => round.status === 'draft');

  return (
    <div className={cn(crm.cardInner, 'grid gap-3')}>
      <div className="flex items-baseline justify-between gap-2">
        <p className={cn('m-0', crm.cardTitle)}>Skyddsrond</p>
        {openActions ? (
          <span className={cn(crm.badge, 'border-amber-200 bg-amber-50 text-amber-900')}>
            {openActions === 1 ? '1 öppen åtgärd' : `${openActions} öppna åtgärder`}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="m-0 text-sm text-slate-500">Hämtar…</p>
      ) : loadError ? (
        <p className="m-0 text-sm text-amber-800">Kunde inte hämta skyddsronderna. Ladda om sidan.</p>
      ) : rounds.length === 0 ? (
        <p className="m-0 text-sm leading-relaxed text-slate-600">
          Checklista och handlingsplan för arbetsmiljön på plats. Fylls i på telefonen under ronden och blir ett protokoll.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-0 divide-y divide-[#e8eee4] p-0">
          {rounds.map((round) => (
            <li key={round.id} className="py-2 first:pt-0 last:pb-0">
              <Link href={`/skyddsrond/${round.id}`} className="flex min-h-11 items-center justify-between gap-3 text-inherit no-underline">
                <div className="min-w-0">
                  <p className={cn('m-0', crm.bodyStrong)}>Rond {round.round_number}</p>
                  <p className={cn('m-0 truncate', crm.meta)}>
                    {[formatDate(round.held_on), round.leader_name].filter(Boolean).join(', ')}
                  </p>
                </div>
                <span className={cn(crm.badge, 'shrink-0', ROUND_STATUS_BADGE[round.status])}>{ROUND_STATUS_LABEL[round.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canWrite && !loading && !loadError ? (
        draft ? (
          <div className="grid gap-2">
            <Link href={`/skyddsrond/${draft.id}`} className={cn(crm.saveButton, 'min-h-11 no-underline')}>
              Fortsätt rond {draft.round_number}
            </Link>
            <button type="button" onClick={() => void start(workOrderId)} disabled={startingFor !== null} className={cn(crm.ghostButton, 'h-9 w-full')}>
              {startingFor ? 'Startar…' : 'Starta en ny rond'}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => void start(workOrderId)} disabled={startingFor !== null} className={cn(crm.saveButton, 'min-h-11')}>
            {startingFor ? 'Startar…' : 'Starta skyddsrond'}
          </button>
        )
      ) : null}
    </div>
  );
}
