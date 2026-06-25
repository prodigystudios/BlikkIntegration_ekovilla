"use client";

import React from 'react';
import Link from 'next/link';
import Badge from '../../../../components/ui/Badge';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import PageShell from '../../../../components/ui/PageShell';
import Textarea from '../../../../components/ui/Textarea';
import { cn } from '../../../../lib/shared/cn';
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
      <section className="grid gap-3 rounded-[22px] border border-ui-border bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] p-5 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent" className="px-2.5 py-1 text-[11px] uppercase tracking-[0.4px]">Adminprofil</Badge>
            <Badge>Roll: {profile.role}</Badge>
            {profile.tags.length > 0 && <Badge>Taggar: {profile.tags.join(', ')}</Badge>}
            <Badge className="bg-white">{authEmail}</Badge>
          </div>
          <Link
            href="/admin?tab=users"
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-950"
          >
            Tillbaka till användare
          </Link>
        </div>

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          <div className="grid max-w-[720px] gap-2">
            <h1 className="m-0 text-[28px] leading-[1.08] tracking-[-0.5px] text-slate-900">{form.full_name || authEmail}</h1>
            <p className="m-0 text-sm leading-[1.55] text-slate-600">
              Hantera vardagsinfo, anställningsdata och känsliga uppgifter i en mer sammanhållen adminvy med tydligare prioritering mellan sektionerna.
            </p>
          </div>

          <div className="grid content-start gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            <StatusTile
              label="Kontaktdata"
              value={form.phone || form.private_email ? 'Kompletterad' : 'Behöver ses över'}
              tone={form.phone || form.private_email ? 'good' : 'neutral'}
            />
            <StatusTile
              label="Anställning"
              value={form.job_title || form.department || form.employment_type ? 'Registrerad' : 'Saknar uppgifter'}
              tone={form.job_title || form.department || form.employment_type ? 'good' : 'neutral'}
            />
            <StatusTile
              label="Känsliga fält"
              value={form.personal_identity_number || form.bank_account_number ? 'Ifyllda' : 'Ej kompletta'}
              tone={form.personal_identity_number || form.bank_account_number ? 'good' : 'neutral'}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-2.5">
        {error && <section className="rounded-[14px] border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</section>}
        {success && <section className="rounded-[14px] border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">{success}</section>}
      </div>

      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <section className="grid gap-[18px] rounded-[20px] border border-ui-border bg-white p-[18px] shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
          <div className="grid gap-1.5">
            <div className="grid gap-1">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.45px] text-slate-500">Daglig profil</span>
              <h2 className="m-0 text-[19px] tracking-[-0.2px] text-slate-900">Kontakt och vardagsinfo</h2>
            </div>
            <p className="m-0 text-[13px] leading-[1.5] text-slate-600">Uppgifter som ofta används i vardagen och som även den anställde delvis kan uppdatera själv.</p>
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
            <Field label="Namn"><Input value={form.full_name} onChange={(event) => updateField('full_name', event.target.value)} /></Field>
            <Field label="Telefon"><Input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} /></Field>
            <Field label="Privat e-post"><Input value={form.private_email} onChange={(event) => updateField('private_email', event.target.value)} /></Field>
            <Field label="Inloggningsmail"><Input value={authEmail} readOnly className="bg-slate-50 text-slate-500" /></Field>
            <Field label="Adress"><Input value={form.address_line1} onChange={(event) => updateField('address_line1', event.target.value)} /></Field>
            <Field label="Postnummer"><Input value={form.postal_code} onChange={(event) => updateField('postal_code', event.target.value)} /></Field>
            <Field label="Ort"><Input value={form.city} onChange={(event) => updateField('city', event.target.value)} /></Field>
            <Field label="Kontakt vid nödfall"><Input value={form.emergency_contact_name} onChange={(event) => updateField('emergency_contact_name', event.target.value)} /></Field>
            <Field label="Telefon vid nödfall"><Input value={form.emergency_contact_phone} onChange={(event) => updateField('emergency_contact_phone', event.target.value)} /></Field>
            <Field label="Klädstorlek"><Input value={form.clothing_size} onChange={(event) => updateField('clothing_size', event.target.value)} /></Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-h-[18px]" />
            <Button type="button" onClick={() => saveSection('contact')} disabled={savingContact} variant="primary">
              {savingContact ? 'Sparar…' : 'Spara kontaktdel'}
            </Button>
          </div>
        </section>

        <div className="grid content-start gap-4">
          <section className="grid gap-4 rounded-[20px] border border-ui-border bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
            <div className="grid gap-1.5">
              <div className="grid gap-1">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.45px] text-slate-500">Intern personaldata</span>
                <h2 className="m-0 text-[19px] tracking-[-0.2px] text-slate-900">Anställningsuppgifter</h2>
              </div>
              <p className="m-0 text-[13px] leading-[1.5] text-slate-600">HR-liknande data och interna anteckningar som admin ansvarar för.</p>
            </div>
            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
              <Field label="Titel"><Input value={form.job_title} onChange={(event) => updateField('job_title', event.target.value)} /></Field>
              <Field label="Avdelning"><Input value={form.department} onChange={(event) => updateField('department', event.target.value)} /></Field>
              <Field label="Ansvarig chef"><Input value={form.manager_name} onChange={(event) => updateField('manager_name', event.target.value)} /></Field>
              <Field label="Anställningsstart"><Input value={form.employment_start_date} onChange={(event) => updateField('employment_start_date', event.target.value)} placeholder="YYYY-MM-DD" /></Field>
              <Field label="Anställningsform"><Input value={form.employment_type} onChange={(event) => updateField('employment_type', event.target.value)} /></Field>
            </div>
            <Field label="Certifikat och behörigheter"><Textarea value={form.certifications} onChange={(event) => updateField('certifications', event.target.value)} className="min-h-[104px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]" /></Field>
            <Field label="Adminanteckningar"><Textarea value={form.admin_notes} onChange={(event) => updateField('admin_notes', event.target.value)} className="min-h-[104px] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]" /></Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-h-[18px]" />
              <Button type="button" onClick={() => saveSection('employment')} disabled={savingEmployment} variant="primary">
                {savingEmployment ? 'Sparar…' : 'Spara anställningsdel'}
              </Button>
            </div>
          </section>

          <section className="grid gap-4 rounded-[20px] border border-ui-border bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
            <div className="grid gap-1.5">
              <div className="grid gap-1">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.45px] text-slate-500">Separat säker del</span>
                <h2 className="m-0 text-[19px] tracking-[-0.2px] text-slate-900">Känsliga uppgifter</h2>
              </div>
              <p className="m-0 text-[13px] leading-[1.5] text-slate-600">Full redigering för admin. De här fälten ligger i separat säker modell och visas maskerat för användaren själv.</p>
            </div>
            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
              <Field label="Personnummer"><Input value={form.personal_identity_number} onChange={(event) => updateField('personal_identity_number', event.target.value)} /></Field>
              <Field label="Kontonamn"><Input value={form.bank_account_name} onChange={(event) => updateField('bank_account_name', event.target.value)} /></Field>
              <Field label="Clearingnummer"><Input value={form.bank_clearing_number} onChange={(event) => updateField('bank_clearing_number', event.target.value)} /></Field>
              <Field label="Kontonummer"><Input value={form.bank_account_number} onChange={(event) => updateField('bank_account_number', event.target.value)} /></Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-h-[18px]" />
              <Button
                type="button"
                onClick={() => saveSection('sensitive')}
                disabled={savingSensitive}
                variant="primary"
                className="border-emerald-800 bg-emerald-800 text-white hover:bg-emerald-900"
              >
                {savingSensitive ? 'Sparar…' : 'Spara känsliga uppgifter'}
              </Button>
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}

function StatusTile({ label, value, tone }: { label: string; value: string; tone: 'good' | 'neutral' }) {
  return (
    <div className={cn('grid min-h-[76px] gap-1 rounded-2xl border px-3 py-2.5', tone === 'good' ? 'border-emerald-200 bg-emerald-50' : 'border-ui-border bg-white')}>
      <span className="text-[11px] font-extrabold uppercase tracking-[0.35px] text-slate-500">{label}</span>
      <strong className="text-[15px] font-bold text-slate-900">{value}</strong>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.45px] text-slate-500">{label}</span>
      {children}
    </label>
  );
}