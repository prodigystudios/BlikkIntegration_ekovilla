"use client";

import React from 'react';
import Link from 'next/link';
import Input from '../../../../components/ui/Input';
import PageShell from '../../../../components/ui/PageShell';
import Textarea from '../../../../components/ui/Textarea';
import { crm } from '../../../crm/lib/crmTokens';
import { cn } from '../../../../lib/shared/cn';
import { ADMIN_CARD, ADMIN_ERROR_BOX, ADMIN_NOTICE_BOX, AdminField, roleBadgeClass } from '../../components/adminUi';
import type { EmployeeProfile, EmployeeSensitiveDetails } from '../../../../lib/profileDetails';

interface AdminUserProfileEditorProps {
  userId: string;
  authEmail: string;
  profile: EmployeeProfile;
  sensitive: EmployeeSensitiveDetails;
}

interface AdminProfileFormState {
  full_name: string;
  phone: string;
  private_email: string;
  address_line1: string;
  postal_code: string;
  city: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  clothing_size: string;
  job_title: string;
  department: string;
  manager_name: string;
  employment_start_date: string;
  employment_type: string;
  certifications: string;
  admin_notes: string;
  personal_identity_number: string;
  bank_account_name: string;
  bank_clearing_number: string;
  bank_account_number: string;
}

function toFormState(profile: EmployeeProfile, sensitive: EmployeeSensitiveDetails): AdminProfileFormState {
  return {
    full_name: profile.full_name || '',
    phone: profile.phone || '',
    private_email: profile.private_email || '',
    address_line1: profile.address_line1 || '',
    postal_code: profile.postal_code || '',
    city: profile.city || '',
    emergency_contact_name: profile.emergency_contact_name || '',
    emergency_contact_phone: profile.emergency_contact_phone || '',
    clothing_size: profile.clothing_size || '',
    job_title: profile.job_title || '',
    department: profile.department || '',
    manager_name: profile.manager_name || '',
    employment_start_date: profile.employment_start_date || '',
    employment_type: profile.employment_type || '',
    certifications: profile.certifications || '',
    admin_notes: profile.admin_notes || '',
    personal_identity_number: sensitive.personal_identity_number || '',
    bank_account_name: sensitive.bank_account_name || '',
    bank_clearing_number: sensitive.bank_clearing_number || '',
    bank_account_number: sensitive.bank_account_number || '',
  };
}

export default function AdminUserProfileEditor({ userId, authEmail, profile, sensitive }: AdminUserProfileEditorProps) {
  const [form, setForm] = React.useState<AdminProfileFormState>(() => toFormState(profile, sensitive));
  const [savingContact, setSavingContact] = React.useState(false);
  const [savingEmployment, setSavingEmployment] = React.useState(false);
  const [savingSensitive, setSavingSensitive] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  function updateField(field: keyof AdminProfileFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
    setSuccess(null);
  }

  async function saveSection(section: 'contact' | 'employment' | 'sensitive') {
    setError(null);
    setSuccess(null);

    const payload =
      section === 'contact'
        ? {
            full_name: form.full_name,
            phone: form.phone,
            private_email: form.private_email,
            address_line1: form.address_line1,
            postal_code: form.postal_code,
            city: form.city,
            emergency_contact_name: form.emergency_contact_name,
            emergency_contact_phone: form.emergency_contact_phone,
            clothing_size: form.clothing_size,
          }
        : section === 'employment'
          ? {
              job_title: form.job_title,
              department: form.department,
              manager_name: form.manager_name,
              employment_start_date: form.employment_start_date,
              employment_type: form.employment_type,
              certifications: form.certifications,
              admin_notes: form.admin_notes,
            }
          : {
              personal_identity_number: form.personal_identity_number,
              bank_account_name: form.bank_account_name,
              bank_clearing_number: form.bank_clearing_number,
              bank_account_number: form.bank_account_number,
            };

    const setSaving = section === 'contact' ? setSavingContact : section === 'employment' ? setSavingEmployment : setSavingSensitive;
    setSaving(true);

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || data?.legacyError || data?.error || 'Kunde inte spara ändringarna.');
      }
      setSuccess(
        section === 'contact'
          ? 'Kontaktuppgifter sparades.'
          : section === 'employment'
            ? 'Anställningsuppgifter sparades.'
            : 'Känsliga uppgifter sparades.',
      );
    } catch (saveError: any) {
      setError(saveError?.message || 'Kunde inte spara ändringarna.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell className="max-w-[1260px] gap-4">
      <section className={cn(crm.cardInner, 'grid gap-3')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(crm.badge, roleBadgeClass(profile.role))}>{profile.role}</span>
              {profile.tags.length > 0 && (
                <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-600')}>{profile.tags.join(', ')}</span>
              )}
              <span className={cn(crm.badge, 'border-slate-200 bg-white text-slate-600')}>{authEmail}</span>
            </div>
            <h1 className={cn('m-0', crm.pageTitle)}>{form.full_name || authEmail}</h1>
            <p className={cn('m-0', crm.pageSubtitle)}>Kontakt, anställning och känsliga uppgifter.</p>
          </div>
          <Link href="/admin?tab=users" className={crm.ghostButton}>
            Tillbaka till användare
          </Link>
        </div>
      </section>

      <div className="grid gap-2.5">
        {error && <div role="alert" className={ADMIN_ERROR_BOX}>{error}</div>}
        {success && <div role="status" className={ADMIN_NOTICE_BOX}>{success}</div>}
      </div>

      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <section className={cn(ADMIN_CARD, 'grid gap-4 p-4')}>
          <h2 className="m-0 text-base font-bold text-slate-900">Kontakt och vardagsinfo</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminField label="Namn"><Input value={form.full_name} onChange={(event) => updateField('full_name', event.target.value)} /></AdminField>
            <AdminField label="Telefon"><Input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} /></AdminField>
            <AdminField label="Privat e-post"><Input value={form.private_email} onChange={(event) => updateField('private_email', event.target.value)} /></AdminField>
            <AdminField label="Inloggningsmail"><Input value={authEmail} readOnly className="bg-[#eef1ec] text-slate-500" /></AdminField>
            <AdminField label="Adress"><Input value={form.address_line1} onChange={(event) => updateField('address_line1', event.target.value)} /></AdminField>
            <AdminField label="Postnummer"><Input value={form.postal_code} onChange={(event) => updateField('postal_code', event.target.value)} /></AdminField>
            <AdminField label="Ort"><Input value={form.city} onChange={(event) => updateField('city', event.target.value)} /></AdminField>
            <AdminField label="Kontakt vid nödfall"><Input value={form.emergency_contact_name} onChange={(event) => updateField('emergency_contact_name', event.target.value)} /></AdminField>
            <AdminField label="Telefon vid nödfall"><Input value={form.emergency_contact_phone} onChange={(event) => updateField('emergency_contact_phone', event.target.value)} /></AdminField>
            <AdminField label="Klädstorlek"><Input value={form.clothing_size} onChange={(event) => updateField('clothing_size', event.target.value)} /></AdminField>
          </div>
          <button
            type="button"
            onClick={() => saveSection('contact')}
            disabled={savingContact}
            className={cn(crm.formButton, 'justify-self-end')}
            style={{ backgroundColor: 'var(--ek-green)' }}
          >
            {savingContact ? 'Sparar…' : 'Spara kontaktdel'}
          </button>
        </section>

        <div className="grid content-start gap-4">
          <section className={cn(ADMIN_CARD, 'grid gap-4 p-4')}>
            <h2 className="m-0 text-base font-bold text-slate-900">Anställningsuppgifter</h2>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <AdminField label="Titel"><Input value={form.job_title} onChange={(event) => updateField('job_title', event.target.value)} /></AdminField>
              <AdminField label="Avdelning"><Input value={form.department} onChange={(event) => updateField('department', event.target.value)} /></AdminField>
              <AdminField label="Ansvarig chef"><Input value={form.manager_name} onChange={(event) => updateField('manager_name', event.target.value)} /></AdminField>
              <AdminField label="Anställningsstart"><Input value={form.employment_start_date} onChange={(event) => updateField('employment_start_date', event.target.value)} placeholder="YYYY-MM-DD" /></AdminField>
              <AdminField label="Anställningsform"><Input value={form.employment_type} onChange={(event) => updateField('employment_type', event.target.value)} /></AdminField>
            </div>
            <AdminField label="Certifikat och behörigheter"><Textarea value={form.certifications} onChange={(event) => updateField('certifications', event.target.value)} className="min-h-[104px]" /></AdminField>
            <AdminField label="Adminanteckningar"><Textarea value={form.admin_notes} onChange={(event) => updateField('admin_notes', event.target.value)} className="min-h-[104px]" /></AdminField>
            <button
              type="button"
              onClick={() => saveSection('employment')}
              disabled={savingEmployment}
              className={cn(crm.formButton, 'justify-self-end')}
              style={{ backgroundColor: 'var(--ek-green)' }}
            >
              {savingEmployment ? 'Sparar…' : 'Spara anställningsdel'}
            </button>
          </section>

          <section className={cn(ADMIN_CARD, 'grid gap-4 p-4')}>
            <div className="grid gap-1">
              <h2 className="m-0 text-base font-bold text-slate-900">Känsliga uppgifter</h2>
              <p className="m-0 text-[13px] leading-[1.5] text-slate-600">Full redigering för admin. De här fälten ligger i separat säker modell och visas maskerat för användaren själv.</p>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <AdminField label="Personnummer"><Input value={form.personal_identity_number} onChange={(event) => updateField('personal_identity_number', event.target.value)} /></AdminField>
              <AdminField label="Kontonamn"><Input value={form.bank_account_name} onChange={(event) => updateField('bank_account_name', event.target.value)} /></AdminField>
              <AdminField label="Clearingnummer"><Input value={form.bank_clearing_number} onChange={(event) => updateField('bank_clearing_number', event.target.value)} /></AdminField>
              <AdminField label="Kontonummer"><Input value={form.bank_account_number} onChange={(event) => updateField('bank_account_number', event.target.value)} /></AdminField>
            </div>
            <button
              type="button"
              onClick={() => saveSection('sensitive')}
              disabled={savingSensitive}
              className={cn(crm.formButton, 'justify-self-end')}
              style={{ backgroundColor: 'var(--ek-green)' }}
            >
              {savingSensitive ? 'Sparar…' : 'Spara känsliga uppgifter'}
            </button>
          </section>
        </div>
      </div>
    </PageShell>
  );
}

