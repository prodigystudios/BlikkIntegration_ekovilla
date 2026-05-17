import type { UserRole } from './roles';

export interface EmployeeProfile {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  private_email: string | null;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  clothing_size: string | null;
  job_title: string | null;
  department: string | null;
  manager_name: string | null;
  employment_start_date: string | null;
  employment_type: string | null;
  certifications: string | null;
  admin_notes: string | null;
  tags: string[];
  blikk_id: number | null;
  sensitive_status: EmployeeSensitiveStatus;
}

export interface EmployeeSensitiveStatus {
  has_personal_identity_number: boolean;
  personal_identity_number_masked: string | null;
  has_bank_details: boolean;
  bank_account_name_masked: string | null;
  bank_account_number_masked: string | null;
  sensitive_details_updated_at: string | null;
}

export interface EmployeeSensitiveDetails {
  personal_identity_number: string | null;
  bank_account_name: string | null;
  bank_clearing_number: string | null;
  bank_account_number: string | null;
  updated_at: string | null;
}

export const SELF_EDITABLE_PROFILE_FIELDS = [
  'full_name',
  'phone',
  'private_email',
  'address_line1',
  'postal_code',
  'city',
  'emergency_contact_name',
  'emergency_contact_phone',
  'clothing_size',
] as const;

const TEXT_FIELDS = [
  'full_name',
  'phone',
  'private_email',
  'address_line1',
  'postal_code',
  'city',
  'emergency_contact_name',
  'emergency_contact_phone',
  'clothing_size',
  'job_title',
  'department',
  'manager_name',
  'employment_type',
  'certifications',
  'admin_notes',
] as const;

export const SENSITIVE_PROFILE_FIELDS = [
  'personal_identity_number',
  'bank_account_name',
  'bank_clearing_number',
  'bank_account_number',
] as const;

export const PROFILE_SELECT = [
  'id',
  'role',
  'full_name',
  'phone',
  'private_email',
  'address_line1',
  'postal_code',
  'city',
  'emergency_contact_name',
  'emergency_contact_phone',
  'clothing_size',
  'tags',
  'blikk_id',
].join(', ');

export const PROFILE_DETAILS_SELECT = [
  'user_id',
  'job_title',
  'department',
  'manager_name',
  'employment_start_date',
  'employment_type',
  'certifications',
  'admin_notes',
].join(', ');

export const SENSITIVE_PROFILE_SELECT = [
  'user_id',
  'personal_identity_number',
  'bank_account_name',
  'bank_clearing_number',
  'bank_account_number',
  'updated_at',
].join(', ');

type ProfileRow = Record<string, unknown> | null | undefined;
type ProfileDetailsRow = Record<string, unknown> | null | undefined;
type SensitiveRow = Record<string, unknown> | null | undefined;

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export function buildSelfProfileUpdates(input: Record<string, unknown>) {
  const profileUpdates: Record<string, string | null> = {};

  for (const field of SELF_EDITABLE_PROFILE_FIELDS) {
    if (!(field in input)) continue;
    profileUpdates[field] = normalizeText(input[field]);
  }

  return profileUpdates;
}

export function buildAdminProfileUpdates(input: Record<string, unknown>) {
  const profileUpdates: Record<string, string | null> = {};
  const fields = [
    'full_name',
    'phone',
    'private_email',
    'address_line1',
    'postal_code',
    'city',
    'emergency_contact_name',
    'emergency_contact_phone',
    'clothing_size',
  ] as const;

  for (const field of fields) {
    if (!(field in input)) continue;
    profileUpdates[field] = normalizeText(input[field]);
  }

  return profileUpdates;
}

export function mergeEmployeeProfile(profileRow: ProfileRow | null | undefined, detailRow: ProfileDetailsRow | null | undefined): EmployeeProfile | null {
  if (!profileRow || typeof profileRow.id !== 'string' || typeof profileRow.role !== 'string') return null;

  return {
    id: profileRow.id,
    role: profileRow.role as UserRole,
    full_name: normalizeText(profileRow.full_name),
    phone: normalizeText(profileRow.phone),
    private_email: normalizeText(profileRow.private_email),
    address_line1: normalizeText(profileRow.address_line1),
    postal_code: normalizeText(profileRow.postal_code),
    city: normalizeText(profileRow.city),
    emergency_contact_name: normalizeText(profileRow.emergency_contact_name),
    emergency_contact_phone: normalizeText(profileRow.emergency_contact_phone),
    clothing_size: normalizeText(profileRow.clothing_size),
    job_title: normalizeText(detailRow?.job_title),
    department: normalizeText(detailRow?.department),
    manager_name: normalizeText(detailRow?.manager_name),
    employment_start_date: normalizeDate(detailRow?.employment_start_date),
    employment_type: normalizeText(detailRow?.employment_type),
    certifications: normalizeText(detailRow?.certifications),
    admin_notes: normalizeText(detailRow?.admin_notes),
    tags: Array.isArray(profileRow.tags) ? profileRow.tags.filter((value): value is string => typeof value === 'string') : [],
    blikk_id: typeof profileRow.blikk_id === 'number' ? profileRow.blikk_id : null,
    sensitive_status: emptySensitiveStatus(),
  };
}

export function mergeSensitiveStatus(sensitiveRow: SensitiveRow): EmployeeSensitiveStatus {
  const personalIdentityNumber = normalizeText(sensitiveRow?.personal_identity_number);
  const bankAccountName = normalizeText(sensitiveRow?.bank_account_name);
  const bankAccountNumber = normalizeText(sensitiveRow?.bank_account_number);
  const bankClearingNumber = normalizeText(sensitiveRow?.bank_clearing_number);

  return {
    has_personal_identity_number: Boolean(personalIdentityNumber),
    personal_identity_number_masked: maskPersonalIdentityNumber(personalIdentityNumber),
    has_bank_details: Boolean(bankAccountName || bankAccountNumber || bankClearingNumber),
    bank_account_name_masked: maskDisplayText(bankAccountName),
    bank_account_number_masked: maskBankAccountNumber(bankAccountNumber),
    sensitive_details_updated_at: normalizeTimestamp(sensitiveRow?.updated_at),
  };
}

export function mergeSensitiveDetails(sensitiveRow: SensitiveRow): EmployeeSensitiveDetails {
  return {
    personal_identity_number: normalizeText(sensitiveRow?.personal_identity_number),
    bank_account_name: normalizeText(sensitiveRow?.bank_account_name),
    bank_clearing_number: normalizeText(sensitiveRow?.bank_clearing_number),
    bank_account_number: normalizeText(sensitiveRow?.bank_account_number),
    updated_at: normalizeTimestamp(sensitiveRow?.updated_at),
  };
}

export function attachSensitiveStatus(profile: EmployeeProfile | null, sensitiveRow: SensitiveRow) {
  if (!profile) return null;
  return {
    ...profile,
    sensitive_status: mergeSensitiveStatus(sensitiveRow),
  };
}

export function buildAdminDetailUpdates(input: Record<string, unknown>) {
  const detailUpdates: Record<string, string | null> = {};

  for (const field of TEXT_FIELDS) {
    if (!(field in input)) continue;
    if (SELF_EDITABLE_PROFILE_FIELDS.includes(field as (typeof SELF_EDITABLE_PROFILE_FIELDS)[number])) continue;
    detailUpdates[field] = normalizeText(input[field]);
  }

  if ('employment_start_date' in input) {
    detailUpdates.employment_start_date = normalizeDate(input.employment_start_date);
  }

  return detailUpdates;
}

export function buildSensitiveProfileUpdates(input: Record<string, unknown>) {
  const updates: Record<string, string | null> = {};

  for (const field of SENSITIVE_PROFILE_FIELDS) {
    if (!(field in input)) continue;
    updates[field] = normalizeText(input[field]);
  }

  return updates;
}

export function emptySensitiveStatus(): EmployeeSensitiveStatus {
  return {
    has_personal_identity_number: false,
    personal_identity_number_masked: null,
    has_bank_details: false,
    bank_account_name_masked: null,
    bank_account_number_masked: null,
    sensitive_details_updated_at: null,
  };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function maskPersonalIdentityNumber(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return 'Registrerat';
  return `******-${digits.slice(-4)}`;
}

function maskBankAccountNumber(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\s/g, '');
  if (digits.length <= 4) return 'Registrerat';
  return `${'*'.repeat(Math.max(digits.length - 4, 4))}${digits.slice(-4)}`;
}

function maskDisplayText(value: string | null) {
  if (!value) return null;
  if (value.length <= 2) return 'Registrerat';
  return `${value.slice(0, 1)}${'*'.repeat(Math.max(value.length - 2, 2))}${value.slice(-1)}`;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}