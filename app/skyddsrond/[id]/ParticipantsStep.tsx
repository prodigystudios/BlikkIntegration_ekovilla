"use client";

import { useId, useMemo, useState } from 'react';
import Select from '@/components/ui/Select';
import KmaNameCombobox from '@/app/crm/arbetsorder/KmaNameCombobox';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { normalizeKmaName, type KmaDirectoryEntry } from '@/lib/domains/crm/kmaPlans/directory';
import type { WorkOrderCrewPerson } from '@/lib/domains/planning/workOrderCrew';
import {
  PARTICIPANT_ROLES,
  PARTICIPANT_ROLE_LABELS,
  type ParticipantRole,
  type SafetyRoundParticipant,
} from '@/lib/domains/safetyRounds/types';
import { Field, TextField } from '../_components/fields';
import SegmentedChoice from '../_components/SegmentedChoice';

// Steg 2 — Deltagare och underskrift, som mallens tabell. Rondledaren står först (sätts när ronden
// startas). Besättningen på ordern föreslås med ett tryck; alla andra skrivs in, med förslag ur
// Kontaktlistan.
//
// "Signatur / initialer" är mallens kolumn. Egen kvittens i appen för den som har ett konto kommer i
// PR 3 — till dess skriver rondledaren initialerna, som på papperet.

type Props = {
  participants: SafetyRoundParticipant[];
  readOnly: boolean;
  directory: readonly KmaDirectoryEntry[];
  crew: readonly WorkOrderCrewPerson[];
  onAdd: (input: { name: string; role: ParticipantRole; profile_id?: string | null }) => Promise<boolean>;
  onPatch: (id: string, patch: Partial<SafetyRoundParticipant>) => void;
  onRemove: (id: string) => void;
};

const PRESENT = [
  { value: 'yes', label: 'Närvarande', selectedClassName: 'border-emerald-700 bg-emerald-700 text-white' },
  { value: 'no', label: 'Frånvarande', selectedClassName: 'border-slate-600 bg-slate-600 text-white' },
] as const;

function RoleSelect({ value, onChange, disabled, id }: { value: ParticipantRole; onChange: (role: ParticipantRole) => void; disabled?: boolean; id: string }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as ParticipantRole)} disabled={disabled} aria-label="Roll">
      {PARTICIPANT_ROLES.map((role) => (
        <option key={role} value={role}>
          {PARTICIPANT_ROLE_LABELS[role]}
        </option>
      ))}
    </Select>
  );
}

function ParticipantRow({ participant, readOnly, onPatch, onRemove }: {
  participant: SafetyRoundParticipant;
  readOnly: boolean;
  onPatch: Props['onPatch'];
  onRemove: Props['onRemove'];
}) {
  const roleId = useId();
  // Kommentaren är sällan ifylld — ihopfälld som på checklistans rader, så att en deltagare tar en
  // skärmhöjd i stället för en och en halv på telefonen.
  const [showComment, setShowComment] = useState(false);
  const text = (key: 'name' | 'company' | 'initials' | 'comment') => (next: string) => {
    const value = next.trim();
    // Namnet är obligatoriskt i databasen — ett tömt namnfält sparas inte, det gamla står kvar.
    if (key === 'name' && !value) return;
    onPatch(participant.id, { [key]: value || null });
  };

  return (
    <li className="grid gap-3 py-4 first:pt-0 last:pb-0">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Namn" value={participant.name} onCommit={text('name')} readOnly={readOnly} maxLength={120} />
        <Field label="Roll" htmlFor={roleId}>
          <RoleSelect id={roleId} value={participant.role} onChange={(role) => onPatch(participant.id, { role })} disabled={readOnly} />
        </Field>
        <TextField label="Företag" value={participant.company} onCommit={text('company')} readOnly={readOnly} maxLength={120} />
        <TextField label="Signatur / initialer" value={participant.initials} onCommit={text('initials')} readOnly={readOnly} maxLength={10} />
      </div>
      <SegmentedChoice
        label={`Närvaro för ${participant.name}`}
        options={PRESENT}
        value={participant.present ? 'yes' : 'no'}
        onChange={(value) => onPatch(participant.id, { present: value === 'yes' })}
        disabled={readOnly}
      />
      {participant.comment || showComment ? (
        <TextField label="Kommentar" value={participant.comment} onCommit={text('comment')} readOnly={readOnly} maxLength={300} />
      ) : null}
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-3">
          {!participant.comment && !showComment ? (
            <button
              type="button"
              onClick={() => setShowComment(true)}
              className="min-h-11 w-fit p-0 px-1 text-sm font-semibold text-slate-600 hover:text-slate-900"
            >
              + Kommentar
            </button>
          ) : null}
          <button type="button" onClick={() => onRemove(participant.id)} className={cn(crm.dangerButton, 'w-fit')}>
            Ta bort {participant.name}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export default function ParticipantsStep({ participants, readOnly, directory, crew, onAdd, onPatch, onRemove }: Props) {
  const nameId = useId();
  const roleId = useId();
  const [name, setName] = useState('');
  const [role, setRole] = useState<ParticipantRole>('installer');
  const [adding, setAdding] = useState(false);

  // Besättningen som ännu inte står i listan. Jämförs på namnet (normaliserat), inte på profilen:
  // en person som skrivits in för hand ska inte föreslås en gång till.
  const crewSuggestions = useMemo(() => {
    const taken = new Set(participants.map((p) => normalizeKmaName(p.name)));
    return crew.filter((person) => !taken.has(normalizeKmaName(person.member_name)));
  }, [crew, participants]);

  async function add(input: { name: string; role: ParticipantRole; profile_id?: string | null }) {
    setAdding(true);
    const added = await onAdd(input);
    setAdding(false);
    return added;
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (await add({ name: trimmed, role })) {
      setName('');
      setRole('installer');
    }
  }

  return (
    <div className="grid gap-4">
      {!readOnly ? (
        <p className={cn('m-0', crm.pageSubtitle)}>
          Minst arbetsgivare eller chef och skyddsombud. Ta med den som jobbar på platsen – de ser det ni missar.
        </p>
      ) : null}

      <section className={cn(crm.cardInner, 'p-4')}>
        {participants.length === 0 ? (
          <p className={cn('m-0', crm.emptyValue)}>Inga deltagare ännu.</p>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-[#e8eee4] p-0">
            {participants.map((participant) => (
              <ParticipantRow key={participant.id} participant={participant} readOnly={readOnly} onPatch={onPatch} onRemove={onRemove} />
            ))}
          </ul>
        )}
      </section>

      {!readOnly ? (
        <section className={cn(crm.cardInner, 'grid gap-4 p-4')}>
          <p className={cn('m-0', crm.cardTitle)}>Lägg till deltagare</p>

          {crewSuggestions.length > 0 ? (
            <div className="grid gap-2">
              <p className={cn('m-0', crm.label)}>Från besättningen på ordern</p>
              <div className="flex flex-wrap gap-2">
                {crewSuggestions.map((person) => (
                  <button
                    key={`${person.member_id ?? ''}:${person.member_name}`}
                    type="button"
                    disabled={adding}
                    onClick={() => void add({ name: person.member_name, role: 'installer', profile_id: person.member_id })}
                    className="min-h-11 rounded-full border border-solid border-[#dce4d8] bg-white p-0 px-4 text-sm font-semibold text-slate-700 hover:border-[#c8d4c3] hover:text-slate-900"
                  >
                    + {person.member_name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
            <Field label="Namn" htmlFor={nameId}>
              <KmaNameCombobox
                id={nameId}
                value={name}
                onChange={setName}
                onPick={(entry) => setName(entry.name)}
                entries={directory}
                placeholder="Sök i Kontaktlistan eller skriv ett namn"
              />
            </Field>
            <Field label="Roll" htmlFor={roleId}>
              <RoleSelect id={roleId} value={role} onChange={setRole} />
            </Field>
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={adding || !name.trim()}
            className={cn(crm.saveButton, 'min-h-11 sm:w-fit sm:px-5')}
          >
            {adding ? 'Lägger till…' : 'Lägg till deltagare'}
          </button>
        </section>
      ) : null}
    </div>
  );
}
