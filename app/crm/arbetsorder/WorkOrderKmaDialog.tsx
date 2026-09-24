"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Input from '@/components/ui/Input';
import CrmModal from '@/app/crm/components/CrmModal';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import { formatDate } from '@/app/crm/lib/format';
import { downloadFortnoxPdf } from '@/app/crm/lib/fortnoxDoc';
import { MATERIAL_SHORTS } from '@/lib/domains/crm/materials';
import { KMA_MATERIAL_INFO } from '@/lib/domains/crm/kmaPlans/materialInfo';
import { kmaFormSchema } from '@/lib/domains/crm/kmaPlans/schemas';
import {
  kmaFieldErrors,
  kmaMissingCrewCount,
  kmaSourceNote,
  mergeKmaCrew,
  pickKmaDirectoryEntry,
  renameKmaRow,
} from '@/lib/domains/crm/kmaPlans/dialog';
import { dedupeDirectory, type KmaDirectoryEntry } from '@/lib/domains/crm/kmaPlans/directory';
import {
  KMA_A8_ONGOING_ROWS,
  KMA_A8_VERIFYING_ROWS,
  KMA_CEO_CONTACT,
  KMA_COMPANY,
  KMA_MAX_CONTACTS,
  KMA_SELF_CHECK_POINTS,
} from '@/lib/domains/crm/kmaPlans/template';
import type { KmaFormValues, KmaPerson } from '@/lib/domains/crm/kmaPlans/types';
import type { KmaPrefillResponse } from './useKmaPlans';
import KmaNameCombobox from './KmaNameCombobox';

// Dialogen där en KMA-plan fylls i och sparas som en ny revision.
//
// Förifylld av servern (…/kma-plans/prefill): projektet ur ordern, organisationen ur den senaste
// planen, besättningen ur planeringen, telefonnummer ur Kontaktlistan. Källraden överst säger
// varifrån — ett ärvt organisationsblock ska synas som ärvt.
//
// ⚠️ ENTER SPARAR INTE. En revision kan inte ändras eller tas bort (den går till kund), så en
// tangent i ett namnfält får inte skapa en. Formuläret förhindrar submit; bara knappen sparar.
//
// ⚠️ KNAPPEN ÄR LÅST TILLS DIALOGEN STÄNGT — inte bara medan POST:en pågår. Efter sparningen laddas
// PDF:en ned (servern renderar den, det tar sekunder), och en knapp som släpptes när POST:en svarat
// sparade en revision till vid ett andra klick. En ref, inte bara state: två klick hinner före en
// omrendering.
//
// 📐 PORTAL till `body` inuti `crm-shell`, som ContactFormModal: sidokolumnen är sticky och klipper
// annars dialogen. Färgerna är `--ek-*` på :root — inget nytt får peka på `--crm-*`.

type Props = {
  /** Från kortet: ordern HAR redan en plan. Avgör rubriken även när förra revisionen inte gick att läsa. */
  mode: 'create' | 'revise';
  nextRevision: number;
  prefill: KmaPrefillResponse;
  saving: boolean;
  onSubmit: (form: KmaFormValues) => Promise<{ pdfUrl: string; filename: string; revision: number } | null>;
  onClose: () => void;
};

type PersonKey = 'projectManager' | 'workEnvironment' | 'environment' | 'quality';

const PERSONS: ReadonlyArray<{ key: PersonKey; label: string }> = [
  { key: 'projectManager', label: 'KMA-ansvarig / projektledare' },
  { key: 'workEnvironment', label: 'Arbetsmiljöansvarig' },
  { key: 'environment', label: 'Miljöansvarig' },
  { key: 'quality', label: 'Kvalitetsansvarig' },
];

const KIND_LABEL = { cellulosa: 'cellulosa', glasull: 'glasull', stenull: 'stenull', trafiber: 'träfiber' } as const;

const CHIP_BASE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-solid px-3.5 text-sm font-semibold transition active:scale-[0.98] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent-ring)]';
const CHIP_OFF = 'border-[#dce4d8] bg-white text-slate-600 hover:border-[#c8d4c3]';
const CHIP_ON = 'border-transparent bg-[color:var(--ek-green)] text-white shadow-[0_2px_8px_rgba(26,63,38,0.24)]';

/** Fältets id ur dess sökväg i formuläret — så ett Zod-fel kan hitta och fokusera sitt fält. */
const fieldId = (path: string) => `kma-${path.replace(/\./g, '-')}`;

// ── Små byggstenar (på modulnivå: definierade i dialogen hade de monterats om vid varje
//    tangenttryckning och tappat fokus) ─────────────────────────────────────────

function FieldError({ path, errors }: { path: string; errors: Record<string, string> }) {
  const message = errors[path];
  if (!message) return null;
  // tabIndex -1: ett fel på en hel lista ("högst 30 kontakter") har inget eget fält att fokusera,
  // så fokus hamnar på meddelandet i stället — utanför tabbordningen.
  return (
    <p id={`${fieldId(path)}-error`} tabIndex={-1} className="m-0 mt-1 text-xs text-rose-700 outline-none">
      {message}
    </p>
  );
}

function TextField(props: {
  path: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  errors: Record<string, string>;
  placeholder?: string;
  inputMode?: 'tel' | 'email' | 'text';
  srOnlyLabel?: boolean;
  /** Namnfält: förslag ur Kontaktlistan, och vad ett val gör med raden. */
  suggest?: { entries: readonly KmaDirectoryEntry[]; onPick: (entry: KmaDirectoryEntry) => void };
}) {
  const id = fieldId(props.path);
  const invalid = Boolean(props.errors[props.path]);
  const describedBy = invalid ? `${id}-error` : undefined;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={cn('block', props.srOnlyLabel ? 'sr-only' : crm.label)}>
        {props.label}
      </label>
      {props.suggest ? (
        <KmaNameCombobox
          id={id}
          value={props.value}
          onChange={props.onChange}
          onPick={props.suggest.onPick}
          entries={props.suggest.entries}
          placeholder={props.placeholder}
          invalid={invalid}
          describedBy={describedBy}
        />
      ) : (
        <Input
          id={id}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          inputMode={props.inputMode}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn('min-h-10', invalid && 'border-rose-400')}
        />
      )}
      <FieldError path={props.path} errors={props.errors} />
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    // p-0: den globala button-regeln (globals.css) ger annars 10 px lodrät padding åt ikonen.
    <button type="button" onClick={onClick} aria-label={label} className={cn(crm.dangerButton, 'h-10 w-10 justify-center p-0')}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

function AddButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn(crm.ghostButton, 'h-9 justify-self-start')}>
      {children}
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-x-0 border-b-0 border-t border-solid border-[#e4ebe0] pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className={cn('m-0', crm.groupTitle)}>{title}</h3>
        {hint ? <p className={cn('m-0 mt-0.5', crm.meta)}>{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

// ── Dialogen ─────────────────────────────────────────────────────────────────

export default function WorkOrderKmaDialog({ mode, nextRevision, prefill, saving, onSubmit, onClose }: Props) {
  const toast = useToast();
  const uid = useId();
  const [mounted, setMounted] = useState(false);
  // Kontaktlistan utan dubbletter — samma person under två kategorier står en gång i förslagen.
  const people = useMemo(() => dedupeDirectory(prefill.directory), [prefill.directory]);
  // En tom fastighetsrad att skriva i när ordern inte gav någon — schemat filtrerar bort tomma rader.
  const [form, setForm] = useState<KmaFormValues>(() => ({
    ...prefill.form,
    project: {
      ...prefill.form.project,
      properties: prefill.form.project.properties.length > 0 ? prefill.form.project.properties : [''],
    },
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<'idle' | 'saving' | 'downloading'>('idle');
  const busy = useRef(false);

  useEffect(() => setMounted(true), []);

  const revise = mode === 'revise';
  const missingCrew = kmaMissingCrewCount(form, prefill.suggestions.crewContacts);

  /**
   * Uppdaterar formuläret och släcker felen på de fält som just ändrats. En nyckel som slutar på
   * `.*` släcker hela listan: felen är nycklade på RADENS INDEX, och tas en rad bort flyttar de
   * annars över till fel rad.
   */
  function update(fn: (current: KmaFormValues) => KmaFormValues, ...clear: string[]) {
    setForm(fn);
    if (clear.length === 0) return;
    setErrors((current) => {
      const next = { ...current };
      for (const key of clear) {
        if (key.endsWith('.*')) {
          const prefix = key.slice(0, -2);
          for (const existing of Object.keys(next)) {
            if (existing === prefix || existing.startsWith(`${prefix}.`)) delete next[existing];
          }
        } else {
          delete next[key];
        }
      }
      return next;
    });
  }

  /** Namnet ändrat — telefonen (och e-posten) följer namnet, se renameKmaRow. */
  function rename<T extends { name: string; phone: string; email?: string }>(row: T, name: string): T {
    return renameKmaRow(row, name, prefill.directory);
  }

  /** Ett val i förslagslistan — namnet och just den personens nummer, se pickKmaDirectoryEntry. */
  function pickInto<T extends { name: string; phone: string; email?: string }>(row: T, entry: KmaDirectoryEntry): T {
    return pickKmaDirectoryEntry(row, entry, prefill.directory);
  }

  function setProject<K extends keyof KmaFormValues['project']>(key: K, value: KmaFormValues['project'][K]) {
    update((c) => ({ ...c, project: { ...c.project, [key]: value } }), `project.${key}`);
  }

  function setPerson(key: PersonKey, field: keyof KmaPerson, value: string) {
    update(
      (c) => {
        const current = c.organisation[key];
        const person = field === 'name' ? rename(current, value) : { ...current, [field]: value };
        return { ...c, organisation: { ...c.organisation, [key]: person } };
      },
      `organisation.${key}.${field}`,
      ...(field === 'name' ? [`organisation.${key}.phone`, `organisation.${key}.email`] : []),
    );
  }

  function samePersonEverywhere() {
    update(
      (c) => {
        const pm = c.organisation.projectManager;
        return {
          ...c,
          organisation: { ...c.organisation, workEnvironment: { ...pm }, environment: { ...pm }, quality: { ...pm } },
        };
      },
      ...PERSONS.flatMap((p) => ['name', 'phone', 'email'].map((f) => `organisation.${p.key}.${f}`)),
    );
  }

  async function save() {
    if (busy.current) return;
    const parsed = kmaFormSchema.safeParse(form);
    if (!parsed.success) {
      const found = kmaFieldErrors(parsed.error);
      setErrors(found);
      const first = Object.keys(found)[0];
      // Fältet fokuseras efter renderingen, när felmeddelandet står under det.
      if (first) {
        requestAnimationFrame(() =>
          (document.getElementById(fieldId(first)) ?? document.getElementById(`${fieldId(first)}-error`))?.focus(),
        );
      }
      return;
    }
    busy.current = true;
    setPhase('saving');
    const saved = await onSubmit(parsed.data);
    if (!saved) {
      // Inget sparades — knappen släpps så man kan rätta och försöka igen.
      busy.current = false;
      setPhase('idle');
      return;
    }
    // Sparat. Knappen förblir låst tills dialogen stängt: ett klick till nu hade blivit en revision till.
    setPhase('downloading');
    // En nedladdning (inte en ny flik): den startar efter en await, och en popup därifrån blockeras.
    await downloadFortnoxPdf(saved.pdfUrl, saved.filename, (message) => toast.error(message));
    onClose();
  }

  const errorCount = Object.keys(errors).length;

  // Efter alla hookar — rules-of-hooks.
  if (!mounted) return null;

  return createPortal(
    <div className="crm-shell">
      <CrmModal
        onClose={onClose}
        ariaLabel={revise ? 'Revidera KMA-planen' : 'Ny KMA-plan'}
        maxWidth="sm:max-w-[760px]"
        header={
          <>
            <h2 className="m-0 text-lg font-bold text-slate-900">{revise ? 'Revidera KMA-planen' : 'Ny KMA-plan'}</h2>
            <p className={cn('m-0 mt-0.5', crm.pageSubtitle)}>
              Revision {nextRevision} för {KMA_COMPANY.name}. Sparas på ordern och kan inte ändras i efterhand.
            </p>
          </>
        }
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-solid border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
            >
              Avbryt
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || phase !== 'idle'}
              className="flex-1 rounded-xl border-0 bg-[color:var(--ek-green)] py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[color:var(--ek-green-strong)] disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
            >
              {phase === 'downloading' ? 'Laddar ned…' : phase === 'saving' || saving ? 'Sparar…' : `Spara revision ${nextRevision} och ladda ned`}
            </button>
          </>
        }
      >
        <form
          id={`${uid}-kma-form`}
          className="grid gap-5"
          noValidate
          onSubmit={(e) => e.preventDefault()}
        >
          {prefill.unreadableRevision !== null ? (
            <p className="m-0 rounded-xl border border-solid border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900">
              Revision {prefill.unreadableRevision} gick inte att läsa in, så formuläret är förifyllt på nytt från ordern.
              Öppna den förra revisionen och kontrollera allt innan du sparar.
            </p>
          ) : null}
          <p className="m-0 rounded-xl border border-solid border-[#dce4d8] bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700">
            {kmaSourceNote(prefill.source, formatDate)}
          </p>

          {errorCount > 0 ? (
            <p role="alert" className="m-0 rounded-xl border border-solid border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
              {errorCount === 1 ? 'Ett fält behöver fyllas i' : `${errorCount} fält behöver fyllas i`} innan planen kan sparas.
            </p>
          ) : null}

          {/* ── Projekt ─────────────────────────────────────────────────────── */}
          <Section title="Projekt">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField path="project.projectName" label="Projektnamn" value={form.project.projectName} onChange={(v) => setProject('projectName', v)} errors={errors} />
              <TextField path="project.customerName" label="Kund" value={form.project.customerName} onChange={(v) => setProject('customerName', v)} errors={errors} />
              <TextField path="project.projectNumber" label="Projektnummer" value={form.project.projectNumber} onChange={(v) => setProject('projectNumber', v)} errors={errors} />
              <TextField path="project.workType" label="Arbetstyp" value={form.project.workType} onChange={(v) => setProject('workType', v)} errors={errors} placeholder="tilläggsisolering" />
            </div>
            <TextField path="project.commitment" label="Åtagande (signaturlistan)" value={form.project.commitment} onChange={(v) => setProject('commitment', v)} errors={errors} />

            <div className="grid gap-2">
              <p className={cn('m-0', crm.label)}>Fastigheter som ska isoleras</p>
              {form.project.properties.map((property, index) => (
                <div key={index} className="grid grid-cols-[1fr_auto] items-start gap-2">
                  <TextField
                    path={`project.properties.${index}`}
                    label={`Fastighet ${index + 1}`}
                    srOnlyLabel
                    value={property}
                    onChange={(v) => setProject('properties', form.project.properties.map((p, i) => (i === index ? v : p)))}
                    errors={errors}
                    placeholder="Fastighetsbeteckning eller adress"
                  />
                  {form.project.properties.length > 1 ? (
                    <RemoveButton
                      label={`Ta bort fastighet ${index + 1}`}
                      onClick={() =>
                        update(
                          (c) => ({ ...c, project: { ...c.project, properties: c.project.properties.filter((_, i) => i !== index) } }),
                          'project.properties.*',
                        )
                      }
                    />
                  ) : null}
                </div>
              ))}
              <FieldError path="project.properties" errors={errors} />
              {form.project.properties.length < 10 ? (
                <AddButton onClick={() => setProject('properties', [...form.project.properties, ''])}>Lägg till fastighet</AddButton>
              ) : null}
            </div>

            <div className="grid gap-2" id={fieldId('project.materials')} tabIndex={-1}>
              <p className={cn('m-0', crm.label)}>Material</p>
              <div className="flex flex-wrap gap-2">
                {MATERIAL_SHORTS.map((short) => {
                  const info = KMA_MATERIAL_INFO[short];
                  const on = form.project.materials.includes(short);
                  return (
                    <button
                      key={short}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setProject('materials', on ? form.project.materials.filter((m) => m !== short) : [...form.project.materials, short])
                      }
                      className={cn(CHIP_BASE, on ? CHIP_ON : CHIP_OFF)}
                    >
                      {info.brand}
                      <span className={cn('ml-1.5 font-medium', on ? 'text-white/80' : 'text-slate-400')}>{KIND_LABEL[info.kind]}</span>
                    </button>
                  );
                })}
              </div>
              <FieldError path="project.materials" errors={errors} />
            </div>
          </Section>

          {/* ── Organisation ────────────────────────────────────────────────── */}
          <Section title="Organisation" hint="Står i planens avsnitt 2 och i bilaga 1. Följer med till nästa plan du skapar.">
            {PERSONS.map(({ key, label }) => (
              <fieldset key={key} className="m-0 grid gap-2 border-0 p-0">
                <legend className={cn('mb-1 p-0', crm.bodyStrong)}>{label}</legend>
                <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1.3fr]">
                  <TextField
                    path={`organisation.${key}.name`}
                    label="Namn"
                    value={form.organisation[key].name}
                    onChange={(v) => setPerson(key, 'name', v)}
                    errors={errors}
                    suggest={{
                      entries: people,
                      onPick: (entry) =>
                        update(
                          (c) => ({ ...c, organisation: { ...c.organisation, [key]: pickInto(c.organisation[key], entry) } }),
                          `organisation.${key}.name`,
                          `organisation.${key}.phone`,
                          `organisation.${key}.email`,
                        ),
                    }}
                  />
                  <TextField path={`organisation.${key}.phone`} label="Telefon" value={form.organisation[key].phone} onChange={(v) => setPerson(key, 'phone', v)} errors={errors} inputMode="tel" />
                  <TextField path={`organisation.${key}.email`} label="E-post" value={form.organisation[key].email} onChange={(v) => setPerson(key, 'email', v)} errors={errors} inputMode="email" />
                </div>
                {key === 'projectManager' ? (
                  <AddButton onClick={samePersonEverywhere} disabled={!form.organisation.projectManager.name.trim()}>
                    Samma person i alla fyra roller
                  </AddButton>
                ) : null}
              </fieldset>
            ))}
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                path="organisation.siteRoundsBy"
                label="Arbetsplatsronder utförs av"
                value={form.organisation.siteRoundsBy}
                onChange={(v) => update((c) => ({ ...c, organisation: { ...c.organisation, siteRoundsBy: v } }), 'organisation.siteRoundsBy')}
                errors={errors}
                suggest={{
                  entries: people,
                  onPick: (entry) =>
                    update((c) => ({ ...c, organisation: { ...c.organisation, siteRoundsBy: entry.name } }), 'organisation.siteRoundsBy'),
                }}
              />
              <TextField
                path="organisation.deviationRecipient"
                label="Avvikelser rapporteras till"
                value={form.organisation.deviationRecipient}
                onChange={(v) => update((c) => ({ ...c, organisation: { ...c.organisation, deviationRecipient: v } }), 'organisation.deviationRecipient')}
                errors={errors}
              />
            </div>
            <details className="rounded-xl border border-solid border-[#e4ebe0] bg-white px-3 py-2">
              <summary className={cn('cursor-pointer', crm.bodyStrong)}>Ansvariga i egenkontrollen</summary>
              <p className={cn('m-0 mt-1', crm.meta)}>Kolumnen Ansvarig i planens egenkontrolltabell.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {KMA_SELF_CHECK_POINTS.map((point) => (
                  <TextField
                    key={point.key}
                    path={`selfCheckResponsible.${point.key}`}
                    label={point.point}
                    value={form.selfCheckResponsible[point.key]}
                    onChange={(v) =>
                      update(
                        (c) => ({ ...c, selfCheckResponsible: { ...c.selfCheckResponsible, [point.key]: v } }),
                        `selfCheckResponsible.${point.key}`,
                      )
                    }
                    errors={errors}
                  />
                ))}
              </div>
            </details>
          </Section>

          {/* ── Kontaktlista ────────────────────────────────────────────────── */}
          <Section title="Kontaktlista" hint="Står i avsnitt 2 och bilaga 7.">
            <ul className={cn('m-0 grid list-none gap-1 p-0', crm.meta)}>
              <li>
                {KMA_CEO_CONTACT.name}, {KMA_CEO_CONTACT.role}, {KMA_CEO_CONTACT.phone} <span className="text-slate-400">(alltid med)</span>
              </li>
              <li>
                {form.organisation.projectManager.name.trim() || 'KMA-ansvarig / projektledare'}, Projektledare{' '}
                <span className="text-slate-400">(från organisationen)</span>
              </li>
            </ul>
            {form.contacts.map((contact, index) => (
              // Mobil: namn + ta bort på första raden, roll + telefon på andra. Från sm försvinner
              // mellanlådan (`contents`) och alla fyra ligger i en rad. Rad OCH kolumn sätts ihop —
              // gridens autoplacering backar aldrig.
              <div key={index} className="grid grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[1.3fr_1fr_1fr_auto]">
                <TextField
                  path={`contacts.${index}.name`}
                  label={`Kontakt ${index + 1}, namn`}
                  srOnlyLabel
                  placeholder="Namn"
                  value={contact.name}
                  suggest={{
                    entries: people,
                    onPick: (entry) =>
                      update(
                        (c) => ({ ...c, contacts: c.contacts.map((row, i) => (i === index ? pickInto(row, entry) : row)) }),
                        `contacts.${index}.name`,
                        `contacts.${index}.phone`,
                      ),
                  }}
                  onChange={(v) =>
                    update(
                      (c) => ({ ...c, contacts: c.contacts.map((row, i) => (i === index ? rename(row, v) : row)) }),
                      `contacts.${index}.name`,
                      `contacts.${index}.phone`,
                    )
                  }
                  errors={errors}
                />
                <div className="col-span-2 row-start-2 grid grid-cols-2 gap-2 sm:contents">
                  <TextField
                    path={`contacts.${index}.role`}
                    label={`Kontakt ${index + 1}, roll`}
                    srOnlyLabel
                    placeholder="Roll"
                    value={contact.role}
                    onChange={(v) => update((c) => ({ ...c, contacts: c.contacts.map((row, i) => (i === index ? { ...row, role: v } : row)) }), `contacts.${index}.role`)}
                    errors={errors}
                  />
                  <TextField
                    path={`contacts.${index}.phone`}
                    label={`Kontakt ${index + 1}, telefon`}
                    srOnlyLabel
                    placeholder="Telefon"
                    inputMode="tel"
                    value={contact.phone}
                    onChange={(v) => update((c) => ({ ...c, contacts: c.contacts.map((row, i) => (i === index ? { ...row, phone: v } : row)) }), `contacts.${index}.phone`)}
                    errors={errors}
                  />
                </div>
                <div className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">
                  <RemoveButton
                    label={`Ta bort ${contact.name || `kontakt ${index + 1}`}`}
                    onClick={() => update((c) => ({ ...c, contacts: c.contacts.filter((_, i) => i !== index) }), 'contacts.*')}
                  />
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <AddButton
                onClick={() => update((c) => ({ ...c, contacts: [...c.contacts, { name: '', role: '', phone: '' }] }))}
                disabled={form.contacts.length >= KMA_MAX_CONTACTS}
              >
                Lägg till kontakt
              </AddButton>
              {missingCrew > 0 && form.contacts.length < KMA_MAX_CONTACTS ? (
                <AddButton onClick={() => update((c) => mergeKmaCrew(c, prefill.suggestions), 'contacts.*', 'signers.ongoing.*')}>
                  Lägg till besättningen från planeringen ({missingCrew})
                </AddButton>
              ) : null}
            </div>
            <FieldError path="contacts" errors={errors} />
            {prefill.crew_count === 0 ? (
              <p className={cn('m-0', crm.meta)}>Planeringen har ingen besättning på ordern. Lägg till installatörerna för hand.</p>
            ) : prefill.crew_count === null ? (
              <p className={cn('m-0', crm.meta)}>Planeringen gick inte att läsa. Lägg till installatörerna för hand.</p>
            ) : null}
          </Section>

          {/* ── Signaturlista ───────────────────────────────────────────────── */}
          <Section title="Signaturlista" hint="Bilaga 8. Namn, roll och datum skrivs ut; signaturen görs på papper.">
            {(
              [
                { key: 'ongoing', title: 'Signerar löpande egenkontroll', max: KMA_A8_ONGOING_ROWS },
                { key: 'verifying', title: 'Signerar verifierande egenkontroll', max: KMA_A8_VERIFYING_ROWS },
              ] as const
            ).map(({ key, title, max }) => (
              <div key={key} className="grid gap-2">
                <p className={cn('m-0', crm.bodyStrong)}>
                  {title} <span className={cn('font-normal', crm.meta)}>(högst {max})</span>
                </p>
                {form.signers[key].map((signer, index) => (
                  <div key={index} className="grid grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[1.3fr_1fr_auto]">
                    <TextField
                      path={`signers.${key}.${index}.name`}
                      label={`${title}, rad ${index + 1}, namn`}
                      srOnlyLabel
                      placeholder="Namn"
                      value={signer.name}
                      suggest={{
                        entries: people,
                        onPick: (entry) =>
                          update(
                            (c) => ({
                              ...c,
                              signers: { ...c.signers, [key]: c.signers[key].map((row, i) => (i === index ? { ...row, name: entry.name } : row)) },
                            }),
                            `signers.${key}.${index}.name`,
                          ),
                      }}
                      onChange={(v) =>
                        update(
                          (c) => ({ ...c, signers: { ...c.signers, [key]: c.signers[key].map((row, i) => (i === index ? { ...row, name: v } : row)) } }),
                          `signers.${key}.${index}.name`,
                        )
                      }
                      errors={errors}
                    />
                    <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                      <TextField
                        path={`signers.${key}.${index}.role`}
                        label={`${title}, rad ${index + 1}, roll`}
                        srOnlyLabel
                        placeholder="Roll"
                        value={signer.role}
                        onChange={(v) =>
                          update(
                            (c) => ({ ...c, signers: { ...c.signers, [key]: c.signers[key].map((row, i) => (i === index ? { ...row, role: v } : row)) } }),
                            `signers.${key}.${index}.role`,
                          )
                        }
                        errors={errors}
                      />
                    </div>
                    <div className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">
                      <RemoveButton
                        label={`Ta bort ${signer.name || `rad ${index + 1}`}`}
                        onClick={() =>
                          update((c) => ({ ...c, signers: { ...c.signers, [key]: c.signers[key].filter((_, i) => i !== index) } }), `signers.${key}.*`)
                        }
                      />
                    </div>
                  </div>
                ))}
                <FieldError path={`signers.${key}`} errors={errors} />
                <AddButton
                  onClick={() => update((c) => ({ ...c, signers: { ...c.signers, [key]: [...c.signers[key], { name: '', role: key === 'ongoing' ? 'Installatör' : 'Arbetsledare' }] } }))}
                  disabled={form.signers[key].length >= max}
                >
                  Lägg till person
                </AddButton>
              </div>
            ))}
          </Section>

          {/* ── Risker ──────────────────────────────────────────────────────── */}
          <Section title="Projektspecifika risker" hint="Utöver planens fyra fasta risker. Står i avsnitt 5 och bilaga 1.">
            {form.extraRisks.map((risk, index) => (
              <div key={index} className="grid grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <TextField
                  path={`extraRisks.${index}.risk`}
                  label={`Risk ${index + 1}`}
                  srOnlyLabel
                  placeholder="Risk, t.ex. asbest i befintlig isolering"
                  value={risk.risk}
                  onChange={(v) => update((c) => ({ ...c, extraRisks: c.extraRisks.map((row, i) => (i === index ? { ...row, risk: v } : row)) }), `extraRisks.${index}.risk`)}
                  errors={errors}
                />
                <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                  <TextField
                    path={`extraRisks.${index}.action`}
                    label={`Åtgärd för risk ${index + 1}`}
                    srOnlyLabel
                    placeholder="Åtgärd"
                    value={risk.action}
                    onChange={(v) => update((c) => ({ ...c, extraRisks: c.extraRisks.map((row, i) => (i === index ? { ...row, action: v } : row)) }), `extraRisks.${index}.action`)}
                    errors={errors}
                  />
                </div>
                <div className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">
                  <RemoveButton
                    label={`Ta bort risk ${index + 1}`}
                    onClick={() => update((c) => ({ ...c, extraRisks: c.extraRisks.filter((_, i) => i !== index) }), 'extraRisks.*')}
                  />
                </div>
              </div>
            ))}
            <FieldError path="extraRisks" errors={errors} />
            <AddButton
              onClick={() => update((c) => ({ ...c, extraRisks: [...c.extraRisks, { risk: '', action: '' }] }))}
              disabled={form.extraRisks.length >= 10}
            >
              Lägg till risk
            </AddButton>
          </Section>
        </form>
      </CrmModal>
    </div>,
    document.body,
  );
}
