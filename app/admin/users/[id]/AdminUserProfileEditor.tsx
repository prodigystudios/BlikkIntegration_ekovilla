"use client";

import React from 'react';
import Link from 'next/link';
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
        throw new Error(data?.error || 'Kunde inte spara ändringarna.');
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
    <main style={pageStyle}>
      <section style={heroStyle}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={eyebrowStyle}>Adminprofil</span>
              <span style={chipStyle}>Roll: {profile.role}</span>
              {profile.tags.length > 0 && <span style={chipStyle}>Taggar: {profile.tags.join(', ')}</span>}
              <span style={mutedChipStyle}>{authEmail}</span>
            </div>
            <Link href="/admin?tab=users" style={linkStyle}>Tillbaka till användare</Link>
          </div>

          <div style={heroContentStyle}>
            <div style={{ display: 'grid', gap: 8, maxWidth: 720 }}>
              <h1 style={heroTitleStyle}>{form.full_name || authEmail}</h1>
              <p style={heroTextStyle}>
                Hantera vardagsinfo, anställningsdata och känsliga uppgifter i en mer sammanhållen adminvy med tydligare prioritering mellan sektionerna.
              </p>
            </div>

            <div style={heroMetaGridStyle}>
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
        </div>
      </section>

      <div style={{ display: 'grid', gap: 10 }}>
        {error && <section style={errorMessageStyle}>{error}</section>}
        {success && <section style={successMessageStyle}>{success}</section>}
      </div>

      <div style={layoutGridStyle}>
        <section style={{ ...mainCardStyle, display: 'grid', gap: 18 }}>
          <div style={sectionHeaderStyle}>
            <div style={{ display: 'grid', gap: 4 }}>
              <span style={sectionEyebrowStyle}>Daglig profil</span>
              <h2 style={sectionTitleStyle}>Kontakt och vardagsinfo</h2>
            </div>
            <p style={sectionTextStyle}>Uppgifter som ofta används i vardagen och som även den anställde delvis kan uppdatera själv.</p>
          </div>
          <div style={formGridStyle}>
            <Field label="Namn"><input value={form.full_name} onChange={(event) => updateField('full_name', event.target.value)} style={inputStyle} /></Field>
            <Field label="Telefon"><input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} style={inputStyle} /></Field>
            <Field label="Privat e-post"><input value={form.private_email} onChange={(event) => updateField('private_email', event.target.value)} style={inputStyle} /></Field>
            <Field label="Inloggningsmail"><input value={authEmail} readOnly style={readOnlyInputStyle} /></Field>
            <Field label="Adress"><input value={form.address_line1} onChange={(event) => updateField('address_line1', event.target.value)} style={inputStyle} /></Field>
            <Field label="Postnummer"><input value={form.postal_code} onChange={(event) => updateField('postal_code', event.target.value)} style={inputStyle} /></Field>
            <Field label="Ort"><input value={form.city} onChange={(event) => updateField('city', event.target.value)} style={inputStyle} /></Field>
            <Field label="Kontakt vid nödfall"><input value={form.emergency_contact_name} onChange={(event) => updateField('emergency_contact_name', event.target.value)} style={inputStyle} /></Field>
            <Field label="Telefon vid nödfall"><input value={form.emergency_contact_phone} onChange={(event) => updateField('emergency_contact_phone', event.target.value)} style={inputStyle} /></Field>
            <Field label="Klädstorlek"><input value={form.clothing_size} onChange={(event) => updateField('clothing_size', event.target.value)} style={inputStyle} /></Field>
          </div>
          <div style={cardFooterStyle}>
            <div style={{ minHeight: 18 }} />
            <button type="button" onClick={() => saveSection('contact')} disabled={savingContact} style={primaryButtonStyle}>{savingContact ? 'Sparar…' : 'Spara kontaktdel'}</button>
          </div>
        </section>

        <div style={sideColumnStyle}>
          <section style={{ ...sideCardStyle, display: 'grid', gap: 16 }}>
            <div style={sectionHeaderStyle}>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={sectionEyebrowStyle}>Intern personaldata</span>
                <h2 style={sectionTitleStyle}>Anställningsuppgifter</h2>
              </div>
              <p style={sectionTextStyle}>HR-liknande data och interna anteckningar som admin ansvarar för.</p>
            </div>
            <div style={compactFormGridStyle}>
              <Field label="Titel"><input value={form.job_title} onChange={(event) => updateField('job_title', event.target.value)} style={inputStyle} /></Field>
              <Field label="Avdelning"><input value={form.department} onChange={(event) => updateField('department', event.target.value)} style={inputStyle} /></Field>
              <Field label="Ansvarig chef"><input value={form.manager_name} onChange={(event) => updateField('manager_name', event.target.value)} style={inputStyle} /></Field>
              <Field label="Anställningsstart"><input value={form.employment_start_date} onChange={(event) => updateField('employment_start_date', event.target.value)} placeholder="YYYY-MM-DD" style={inputStyle} /></Field>
              <Field label="Anställningsform"><input value={form.employment_type} onChange={(event) => updateField('employment_type', event.target.value)} style={inputStyle} /></Field>
            </div>
            <Field label="Certifikat och behörigheter"><textarea value={form.certifications} onChange={(event) => updateField('certifications', event.target.value)} style={textareaStyle} /></Field>
            <Field label="Adminanteckningar"><textarea value={form.admin_notes} onChange={(event) => updateField('admin_notes', event.target.value)} style={textareaStyle} /></Field>
            <div style={cardFooterStyle}>
              <div style={{ minHeight: 18 }} />
              <button type="button" onClick={() => saveSection('employment')} disabled={savingEmployment} style={primaryButtonStyle}>{savingEmployment ? 'Sparar…' : 'Spara anställningsdel'}</button>
            </div>
          </section>

          <section style={{ ...sideCardStyle, display: 'grid', gap: 16 }}>
            <div style={sectionHeaderStyle}>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={sectionEyebrowStyle}>Separat säker del</span>
                <h2 style={sectionTitleStyle}>Känsliga uppgifter</h2>
              </div>
              <p style={sectionTextStyle}>Full redigering för admin. De här fälten ligger i separat säker modell och visas maskerat för användaren själv.</p>
            </div>
            <div style={compactFormGridStyle}>
              <Field label="Personnummer"><input value={form.personal_identity_number} onChange={(event) => updateField('personal_identity_number', event.target.value)} style={inputStyle} /></Field>
              <Field label="Kontonamn"><input value={form.bank_account_name} onChange={(event) => updateField('bank_account_name', event.target.value)} style={inputStyle} /></Field>
              <Field label="Clearingnummer"><input value={form.bank_clearing_number} onChange={(event) => updateField('bank_clearing_number', event.target.value)} style={inputStyle} /></Field>
              <Field label="Kontonummer"><input value={form.bank_account_number} onChange={(event) => updateField('bank_account_number', event.target.value)} style={inputStyle} /></Field>
            </div>
            <div style={cardFooterStyle}>
              <div style={{ minHeight: 18 }} />
              <button type="button" onClick={() => saveSection('sensitive')} disabled={savingSensitive} style={secondaryButtonStyle}>{savingSensitive ? 'Sparar…' : 'Spara känsliga uppgifter'}</button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function StatusTile({ label, value, tone }: { label: string; value: string; tone: 'good' | 'neutral' }) {
  return (
    <div style={{ ...statusTileStyle, borderColor: tone === 'good' ? '#bbf7d0' : '#dbe4ef', background: tone === 'good' ? '#f0fdf4' : '#ffffff' }}>
      <span style={statusTileLabelStyle}>{label}</span>
      <strong style={statusTileValueStyle}>{value}</strong>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={fieldWrapperStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

const pageStyle: React.CSSProperties = {
  display: 'grid',
  gap: 16,
  padding: '18px 18px 30px',
  maxWidth: 1260,
  margin: '0 auto',
};

const heroStyle: React.CSSProperties = {
  border: '1px solid #dde7f1',
  borderRadius: 22,
  padding: '18px 20px',
  background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
  boxShadow: '0 10px 28px rgba(15,23,42,0.04)',
};

const heroContentStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 14,
};

const heroTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 28,
  lineHeight: 1.08,
  letterSpacing: -0.5,
  color: '#0f172a',
};

const heroTextStyle: React.CSSProperties = {
  margin: 0,
  color: '#526275',
  fontSize: 14,
  lineHeight: 1.55,
};

const heroMetaGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 10,
  alignContent: 'start',
};

const layoutGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 16,
  alignItems: 'start',
};

const mainCardStyle: React.CSSProperties = {
  border: '1px solid #dbe4ef',
  background: '#fff',
  borderRadius: 20,
  padding: 18,
  boxShadow: '0 10px 24px rgba(15,23,42,0.04)',
};

const sideColumnStyle: React.CSSProperties = {
  display: 'grid',
  gap: 16,
  alignContent: 'start',
};

const sideCardStyle: React.CSSProperties = {
  ...mainCardStyle,
  padding: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 19,
  color: '#0f172a',
  letterSpacing: -0.2,
};

const sectionTextStyle: React.CSSProperties = {
  margin: 0,
  color: '#5f6f81',
  fontSize: 13,
  lineHeight: 1.5,
};

const eyebrowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 9px',
  borderRadius: 999,
  background: '#dbeafe',
  border: '1px solid #bfdbfe',
  color: '#2563eb',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: 999,
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  color: '#475569',
  fontSize: 11,
  fontWeight: 700,
};

const mutedChipStyle: React.CSSProperties = {
  ...chipStyle,
  background: '#ffffff',
};

const linkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px 13px',
  borderRadius: 10,
  background: '#0f172a',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  textDecoration: 'none',
};

const messageStyle: React.CSSProperties = {
  border: '1px solid',
  borderRadius: 14,
  padding: '11px 13px',
  fontSize: 13,
};

const errorMessageStyle: React.CSSProperties = {
  ...messageStyle,
  borderColor: '#fecaca',
  color: '#b91c1c',
  background: '#fef2f2',
};

const successMessageStyle: React.CSSProperties = {
  ...messageStyle,
  borderColor: '#bbf7d0',
  color: '#166534',
  background: '#ecfdf5',
};

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: 12,
};

const compactFormGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
};

const fieldWrapperStyle: React.CSSProperties = {
  display: 'grid',
  gap: 5,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.45,
  color: '#64748b',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
};

const sectionEyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.45,
  textTransform: 'uppercase',
  color: '#64748b',
};

const inputStyle: React.CSSProperties = {
  border: '1px solid #d7e0ea',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 14,
  color: '#0f172a',
  background: '#fff',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
};

const readOnlyInputStyle: React.CSSProperties = {
  ...inputStyle,
  background: '#f8fafc',
  color: '#64748b',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 104,
  resize: 'vertical',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 15px',
  borderRadius: 10,
  border: '1px solid #0f172a',
  background: '#0f172a',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: '0 8px 18px rgba(15,23,42,0.12)',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: '#14532d',
  border: '1px solid #14532d',
  boxShadow: '0 8px 18px rgba(20,83,45,0.12)',
};

const cardFooterStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

const statusTileStyle: React.CSSProperties = {
  display: 'grid',
  gap: 5,
  border: '1px solid',
  borderRadius: 16,
  padding: '11px 12px 10px',
  minHeight: 76,
};

const statusTileLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.35,
  textTransform: 'uppercase',
  color: '#64748b',
};

const statusTileValueStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: '#0f172a',
};