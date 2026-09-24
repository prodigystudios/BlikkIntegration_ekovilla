"use client";

import { useState } from 'react';
import DatePicker from '@/components/ui/DatePicker';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { SafetyRound } from '@/lib/domains/safetyRounds/types';
import type { KmaDirectoryEntry } from '@/lib/domains/crm/kmaPlans/directory';
import { Field, NameField, TextField } from '../_components/fields';
import SegmentedChoice from '../_components/SegmentedChoice';

// Steg 1 — Rondinfo, som mallens flik 1. Allt utom datum är fritext som rondledaren kan justera:
// adress, beställare, arbetsgivare och typ av arbete är förifyllda när ronden startas.

type Props = {
  round: SafetyRound;
  readOnly: boolean;
  canDelete: boolean;
  deleting: boolean;
  directory: readonly KmaDirectoryEntry[];
  onPatch: (patch: Partial<SafetyRound>) => void;
  onDelete: () => void;
};

const YES_NO = [
  { value: 'yes', label: 'Ja', selectedClassName: 'border-emerald-700 bg-emerald-700 text-white' },
  { value: 'no', label: 'Nej', selectedClassName: 'border-slate-600 bg-slate-600 text-white' },
] as const;

export default function RoundInfoStep({ round, readOnly, canDelete, deleting, directory, onPatch, onDelete }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const text = (key: keyof SafetyRound) => (next: string) => onPatch({ [key]: next.trim() || null } as Partial<SafetyRound>);

  return (
    <div className="grid gap-4">
      <section className={cn(crm.cardInner, 'grid gap-4 p-4')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Projekt / adress"
            value={round.site_address}
            onCommit={text('site_address')}
            readOnly={readOnly}
            maxLength={300}
            className="sm:col-span-2"
          />
          <TextField label="Objekt / husnr" value={round.object_label} onCommit={text('object_label')} readOnly={readOnly} placeholder="T.ex. Hus 3" />
          <TextField label="Entreprenadmoment" value={round.contract_step} onCommit={text('contract_step')} readOnly={readOnly} placeholder="T.ex. Isolering vindsbjälklag" />

          <Field label="Datum" htmlFor={`held-on-${round.id}`}>
            <DatePicker
              id={`held-on-${round.id}`}
              value={round.held_on}
              // Datumet är obligatoriskt: ingen Rensa, och ett tomt val sparas aldrig.
              clearable={false}
              disabled={readOnly}
              onChange={(iso) => {
                if (iso && iso !== round.held_on) onPatch({ held_on: iso });
              }}
            />
          </Field>
          <TextField
            label="Klockslag"
            type="time"
            value={round.held_at ? round.held_at.slice(0, 5) : null}
            onCommit={(next) => onPatch({ held_at: next || null })}
            readOnly={readOnly}
          />

          <TextField label="Beställare / byggherre" value={round.client_label} onCommit={text('client_label')} readOnly={readOnly} />
          <TextField label="Arbetsgivare" value={round.employer} onCommit={text('employer')} readOnly={readOnly} />
          <TextField label="Typ av arbete" value={round.work_type} onCommit={text('work_type')} readOnly={readOnly} />
          <TextField label="Väder / förhållanden" value={round.weather} onCommit={text('weather')} readOnly={readOnly} placeholder="T.ex. Mulet, +8, blåsigt" maxLength={120} />
        </div>
      </section>

      <section className={cn(crm.cardInner, 'grid gap-4 p-4')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <NameField
            label="Rondledare (chef)"
            value={round.leader_name}
            onCommit={text('leader_name')}
            readOnly={readOnly}
            directory={directory}
          />
          <NameField
            label="Skyddsombud"
            value={round.safety_rep_name}
            onCommit={text('safety_rep_name')}
            readOnly={readOnly}
            directory={directory}
          />
          <Field label="Nästa rond senast" htmlFor={`next-due-${round.id}`} hint="Gärna vid varje nytt objekt, eller varje vecka på längre jobb.">
            <DatePicker
              id={`next-due-${round.id}`}
              value={round.next_round_due ?? ''}
              disabled={readOnly}
              onChange={(iso) => onPatch({ next_round_due: iso || null })}
            />
          </Field>
          <div className="grid content-start gap-1">
            <p className={cn('m-0', crm.label)}>
              Uppföljning av förra ronden gjord?
            </p>
            <SegmentedChoice
              label="Uppföljning av förra ronden gjord?"
              options={YES_NO}
              value={round.previous_followed_up === null ? null : round.previous_followed_up ? 'yes' : 'no'}
              onChange={(value) => onPatch({ previous_followed_up: value === 'yes' })}
              disabled={readOnly}
            />
          </div>
        </div>
      </section>

      {canDelete ? (
        <div className="flex flex-wrap items-center gap-3">
          {confirmDelete ? (
            <>
              <p className={cn('m-0', crm.meta)}>Utkastet och allt som fyllts i tas bort. Det går inte att ångra.</p>
              <button type="button" onClick={onDelete} disabled={deleting} className={cn(crm.dangerButton, 'border-rose-300 text-rose-700')}>
                {deleting ? 'Tar bort…' : 'Ta bort utkastet'}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className={crm.ghostButton}>
                Avbryt
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className={crm.dangerButton}>
              Ta bort utkastet
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
