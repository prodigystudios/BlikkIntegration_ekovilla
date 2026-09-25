"use client";

import { useId, useMemo, useState } from 'react';
import DatePicker from '@/components/ui/DatePicker';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { KmaDirectoryEntry } from '@/lib/domains/crm/kmaPlans/directory';
import { describeItem } from '@/lib/domains/safetyRounds/completion';
import { formatPhotoRefs } from '@/lib/domains/safetyRounds/photoRules';
import {
  ACTION_EFFECTS,
  ACTION_EFFECT_LABELS,
  ACTION_STATUSES,
  ACTION_STATUS_LABELS,
  RISK_LABELS,
  RISK_LEVELS,
  type ActionEffect,
  type ActionStatus,
  type RiskLevel,
  type SafetyRoundAction,
  type SafetyRoundItem,
} from '@/lib/domains/safetyRounds/types';
import { Field, NameField, TextAreaField, TextField } from '../_components/fields';
import SegmentedChoice from '../_components/SegmentedChoice';
import { ACTION_STATUS_BADGE, RISK_SELECTED } from '../_components/safetyUi';

// Steg 4 — Handlingsplanen, som mallens flik 3: varje brist som inte åtgärdas direkt får åtgärd,
// ansvarig och datum.
//
// I ett utkast går allt att ändra. När ronden är slutförd är själva åtgärden låst — det är vad
// protokollet sa — men UPPFÖLJNINGEN (status, uppföljt datum, effekt, notering) förs in efteråt,
// när åtgärden görs. Därför har kortet två delar, och den nedre är öppen så länge man har
// skrivnyckeln.

type Props = {
  actions: SafetyRoundAction[];
  items: SafetyRoundItem[];
  /** Ronden är slutförd eller läsaren saknar skrivnyckeln — själva åtgärden går inte att ändra. */
  lockedCore: boolean;
  /** Uppföljningen går att föra in (skrivnyckeln, även efter slutförd rond). */
  canFollowUp: boolean;
  directory: readonly KmaDirectoryEntry[];
  /** Fotonumren per punkt — åtgärden visar sin punkts foton ("Foto 1, 2"), som protokollet. */
  photoNumbersByItem: ReadonlyMap<string, number[]>;
  onAdd: (input: { finding: string }) => Promise<unknown>;
  onPatch: (id: string, patch: Partial<SafetyRoundAction>) => void;
  onRemove: (id: string) => void;
};

const RISK_OPTIONS = [
  { value: 'none' as const, label: '–', selectedClassName: RISK_SELECTED.none },
  ...RISK_LEVELS.map((value) => ({ value, label: RISK_LABELS[value], selectedClassName: RISK_SELECTED[value] })),
];

const EFFECT_OPTIONS = ACTION_EFFECTS.map((value) => ({
  value,
  label: ACTION_EFFECT_LABELS[value],
  selectedClassName:
    value === 'yes'
      ? 'border-emerald-700 bg-emerald-700 text-white'
      : value === 'no'
        ? 'border-rose-700 bg-rose-700 text-white'
        : value === 'partial'
          ? 'border-amber-400 bg-amber-400 text-amber-950'
          : 'border-slate-600 bg-slate-600 text-white',
}));

function ActionCard({ action, index, item, photoRefs, lockedCore, canFollowUp, directory, onPatch, onRemove }: {
  action: SafetyRoundAction;
  index: number;
  item: SafetyRoundItem | undefined;
  /** "Foto 1, 2" — tom sträng utan foton. */
  photoRefs: string;
} & Pick<Props, 'lockedCore' | 'canFollowUp' | 'directory' | 'onPatch' | 'onRemove'>) {
  const dueId = useId();
  const statusId = useId();
  const followedId = useId();
  // Uppföljningen förs in när åtgärden GÖRS, inte under ronden. I ett utkast är den därför ihopfälld
  // — fyra fält till per åtgärd hade gjort formuläret på plats dubbelt så långt för ingenting. Har
  // något redan förts in, eller är ronden slutförd, står den öppen.
  const hasFollowUp = action.status !== 'not_started' || action.followed_up_on !== null || action.effect !== null || !!action.cost_note;
  const [followUpOpen, setFollowUpOpen] = useState(lockedCore || hasFollowUp);
  const patch = (next: Partial<SafetyRoundAction>) => onPatch(action.id, next);
  const text = (key: 'finding' | 'action' | 'responsible_name' | 'cost_note') => (next: string) => {
    const value = next.trim();
    // "Risk / brist" är obligatorisk i databasen — ett tömt fält sparas inte, det gamla står kvar.
    if (key === 'finding' && !value) return;
    patch({ [key]: value || null });
  };

  return (
    <li className={cn(crm.cardInner, 'grid gap-4 p-4')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn('m-0', crm.cardTitle)}>
          Åtgärd {index + 1}
          {item ? <span className={cn('ml-2 font-normal', crm.meta)}>från {describeItem(item).toLowerCase()}</span> : null}
        </p>
        <span className={cn(crm.badge, ACTION_STATUS_BADGE[action.status])}>{ACTION_STATUS_LABELS[action.status]}</span>
        {photoRefs ? <p className={cn('m-0 basis-full', crm.meta)}>{photoRefs}</p> : null}
      </div>

      <TextAreaField label="Risk / brist" value={action.finding} onCommit={text('finding')} readOnly={lockedCore} maxLength={500} />

      <div>
        <p className={cn('m-0 mb-1', crm.label)}>Risknivå</p>
        <SegmentedChoice<'none' | RiskLevel>
          label={`Risknivå för åtgärd ${index + 1}`}
          options={RISK_OPTIONS}
          value={action.risk ?? 'none'}
          onChange={(value) => patch({ risk: value === 'none' ? null : value })}
          disabled={lockedCore}
          columnsClassName="grid-cols-3 sm:grid-cols-5"
        />
      </div>

      <TextAreaField
        label="Åtgärd (vad ska göras)"
        value={action.action}
        onCommit={text('action')}
        readOnly={lockedCore}
        maxLength={500}
        placeholder="Kort och konkret: ”Sätt räcke vid taklucka hus 3”, inte ”förbättra fallskydd”."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <NameField
          label="Ansvarig"
          value={action.responsible_name}
          onCommit={text('responsible_name')}
          readOnly={lockedCore}
          directory={directory}
          hint={lockedCore ? undefined : 'En person per åtgärd – inte ”alla”.'}
        />
        <Field label="Klart senast" htmlFor={dueId} hint={lockedCore ? undefined : 'Ett riktigt datum, inte ”asap”.'}>
          <DatePicker id={dueId} value={action.due_on ?? ''} disabled={lockedCore} onChange={(iso) => patch({ due_on: iso || null })} />
        </Field>
      </div>

      {!followUpOpen && !lockedCore ? (
        <button
          type="button"
          onClick={() => setFollowUpOpen(true)}
          aria-expanded={false}
          className="min-h-11 w-full justify-start border-0 border-t border-solid border-[#e8eee4] p-0 pt-3 text-left text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          + Uppföljning (förs in när åtgärden görs)
        </button>
      ) : (
        <div className="grid gap-4 border-0 border-t border-solid border-[#e8eee4] pt-4">
          <p className={cn('m-0', crm.groupTitle)}>Uppföljning</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" htmlFor={statusId}>
              <Select
                id={statusId}
                value={action.status}
                onChange={(e) => patch({ status: e.target.value as ActionStatus })}
                disabled={!canFollowUp}
              >
                {ACTION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {ACTION_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Uppföljt datum" htmlFor={followedId}>
              <DatePicker id={followedId} value={action.followed_up_on ?? ''} disabled={!canFollowUp} onChange={(iso) => patch({ followed_up_on: iso || null })} />
            </Field>
          </div>
          <div>
            <p className={cn('m-0 mb-1', crm.label)}>Effekt OK – försvann risken?</p>
            <SegmentedChoice<ActionEffect>
              label={`Effekt för åtgärd ${index + 1}`}
              options={EFFECT_OPTIONS}
              value={action.effect}
              onChange={(effect) => patch({ effect })}
              disabled={!canFollowUp}
              columnsClassName="grid-cols-2 sm:grid-cols-4"
            />
          </div>
          <TextField label="Kostnad / notering" value={action.cost_note} onCommit={text('cost_note')} readOnly={!canFollowUp} maxLength={300} />
        </div>
      )}

      {!lockedCore ? (
        <button type="button" onClick={() => onRemove(action.id)} className={cn(crm.dangerButton, 'w-fit')}>
          Ta bort åtgärden
        </button>
      ) : null}
    </li>
  );
}

function AddAction({ onAdd }: { onAdd: Props['onAdd'] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [finding, setFinding] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const trimmed = finding.trim();
    if (!trimmed) return;
    setSaving(true);
    const added = await onAdd({ finding: trimmed });
    setSaving(false);
    if (added) {
      setFinding('');
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cn(crm.ghostButton, 'min-h-11 w-full')}>
        + Lägg till åtgärd utan kontrollpunkt
      </button>
    );
  }

  return (
    <div className={cn(crm.cardInner, 'grid gap-3 p-4')}>
      <label htmlFor={id} className={cn('m-0', crm.label)}>
        Risk / brist
      </label>
      <Textarea id={id} autoGrow rows={2} value={finding} onChange={(e) => setFinding(e.target.value)} maxLength={500} autoFocus />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void submit()} disabled={saving || !finding.trim()} className={cn(crm.saveButton, 'min-h-11 w-auto px-5')}>
          {saving ? 'Lägger till…' : 'Lägg till åtgärd'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={cn(crm.ghostButton, 'min-h-11')}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

export default function ActionsStep({ actions, items, lockedCore, canFollowUp, directory, photoNumbersByItem, onAdd, onPatch, onRemove }: Props) {
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  return (
    <div className="grid gap-4">
      <p className={cn('m-0', crm.pageSubtitle)}>
        Varje brist som inte åtgärdas omedelbart ska ha åtgärd, ansvarig person och datum (AFS 2023:1 §13).
      </p>

      {actions.length === 0 ? (
        <div className={cn(crm.cardInner, 'p-4')}>
          <p className={cn('m-0', crm.bodyStrong)}>Inga åtgärder ännu</p>
          <p className={cn('m-0 mt-1', crm.meta)}>
            {lockedCore
              ? 'Ronden hittade inget som behövde föras till handlingsplanen.'
              : 'En punkt hamnar här när du svarar Ja på ”Förs till handlingsplan?” och trycker Lägg till i handlingsplanen.'}
          </p>
        </div>
      ) : (
        <ol className="m-0 grid list-none gap-4 p-0">
          {actions.map((action, index) => (
            <ActionCard
              key={action.id}
              action={action}
              index={index}
              item={action.item_id ? itemById.get(action.item_id) : undefined}
              photoRefs={action.item_id ? formatPhotoRefs(photoNumbersByItem.get(action.item_id) ?? []) : ''}
              lockedCore={lockedCore}
              canFollowUp={canFollowUp}
              directory={directory}
              onPatch={onPatch}
              onRemove={onRemove}
            />
          ))}
        </ol>
      )}

      {!lockedCore ? <AddAction onAdd={onAdd} /> : null}
    </div>
  );
}
