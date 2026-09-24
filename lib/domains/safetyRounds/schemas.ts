import { z } from 'zod';

import {
  ACTION_EFFECTS,
  ACTION_STATUSES,
  ITEM_STATUSES,
  PARTICIPANT_ROLES,
  RISK_LEVELS,
  TO_ACTION_PLAN,
} from './types';

// Validering av skyddsrondens rutter. Varje fält i formuläret sparas för sig (PATCH per ändring),
// så alla scheman är PARTIELLA: det som saknas i kroppen rörs inte.
//
// Tom text blir null — "inte ifyllt" ska se likadant ut i databasen vare sig fältet aldrig rörts
// eller tömts. Maxlängderna är till för att texten ska rymmas i protokollets tabellceller, inte
// affärsregler.
//
// ⚠️ Zod släpper okända nycklar. Rondens order, nummer, status och skapare går aldrig att sätta
// härifrån — de kommer ur start_safety_round() och triggern i databasen.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

/** Fritext som får vara tom: trimmas, tom -> null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Högst ${max} tecken`)
    .nullable()
    .transform((value) => (value ? value : null));

const requiredText = (max: number, message: string) => z.string().trim().min(1, message).max(max, `Högst ${max} tecken`);

const optionalDate = z
  .string()
  .regex(DATE_RE, 'Ogiltigt datum')
  .nullable()
  .or(z.literal('').transform(() => null));

const requiredDate = z.string().regex(DATE_RE, 'Ogiltigt datum');

// ── Rondinfo ─────────────────────────────────────────────────────────────────

export const roundPatchSchema = z
  .object({
    site_address: optionalText(300),
    object_label: optionalText(200),
    held_on: requiredDate,
    held_at: z
      .string()
      .regex(TIME_RE, 'Ogiltigt klockslag (TT:MM)')
      .nullable()
      .or(z.literal('').transform(() => null)),
    client_label: optionalText(200),
    contract_step: optionalText(200),
    employer: optionalText(200),
    work_type: optionalText(200),
    weather: optionalText(120),
    leader_name: optionalText(120),
    safety_rep_name: optionalText(120),
    next_round_due: optionalDate,
    previous_followed_up: z.boolean().nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Inget att spara');

export type RoundPatch = z.infer<typeof roundPatchSchema>;

// ── Deltagare ────────────────────────────────────────────────────────────────

const participantFields = {
  name: requiredText(120, 'Ange namn'),
  role: z.enum(PARTICIPANT_ROLES),
  company: optionalText(120),
  present: z.boolean(),
  initials: optionalText(10),
  comment: optionalText(300),
};

export const participantCreateSchema = z.object({
  ...participantFields,
  // Förslagen ur besättningen bär personens id; ett namn som skrivits för hand har inget.
  profile_id: z.string().uuid().nullable().optional().default(null),
  present: z.boolean().optional().default(true),
  company: optionalText(120).optional().default(null),
  initials: optionalText(10).optional().default(null),
  comment: optionalText(300).optional().default(null),
});

export const participantPatchSchema = z
  .object(participantFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Inget att spara');

// ── Checklistans punkter ─────────────────────────────────────────────────────

export const itemPatchSchema = z
  .object({
    status: z.enum(ITEM_STATUSES).nullable(),
    risk: z.enum(RISK_LEVELS).nullable(),
    description: optionalText(1000),
    fixed_on_site: z.boolean().nullable(),
    to_action_plan: z.enum(TO_ACTION_PLAN).nullable(),
    comment: optionalText(500),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Inget att spara');

/** En egen punkt ("Lägg till fler risker…"). Kategorin prövas mot katalogen i rutten. */
export const customItemCreateSchema = z.object({
  category_code: z.string().trim().min(1, 'Välj kategori').max(4),
  text: requiredText(300, 'Beskriv kontrollpunkten'),
});

// ── Handlingsplanen ──────────────────────────────────────────────────────────

const actionFields = {
  item_id: z.string().uuid().nullable(),
  finding: requiredText(500, 'Beskriv risken eller bristen'),
  risk: z.enum(RISK_LEVELS).nullable(),
  action: optionalText(500),
  responsible_name: optionalText(120),
  due_on: optionalDate,
  status: z.enum(ACTION_STATUSES),
  followed_up_on: optionalDate,
  effect: z.enum(ACTION_EFFECTS).nullable(),
  cost_note: optionalText(300),
};

export const actionCreateSchema = z.object({
  item_id: actionFields.item_id.optional().default(null),
  finding: actionFields.finding,
  risk: actionFields.risk.optional().default(null),
  action: actionFields.action.optional().default(null),
  responsible_name: actionFields.responsible_name.optional().default(null),
  due_on: actionFields.due_on.optional().default(null),
});

export const actionPatchSchema = z
  .object(actionFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Inget att spara');

/**
 * Fälten som får ändras på en åtgärd efter att ronden slutförts — uppföljningen. Resten är låst av
 * triggern i databasen; rutten svarar tydligt i stället för att låta databasen kasta.
 */
export const FOLLOW_UP_FIELDS = ['status', 'followed_up_on', 'effect', 'cost_note'] as const;

// ── Starta ───────────────────────────────────────────────────────────────────

export const startRoundSchema = z.object({
  work_order_id: z.string().uuid('Välj en arbetsorder'),
});

export const orderSearchSchema = z.object({
  q: z.string().trim().min(2, 'Skriv minst två tecken').max(80),
});
