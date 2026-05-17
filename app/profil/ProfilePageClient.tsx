"use client";

import React from 'react';
import type { EmployeeProfile, EmployeeSensitiveStatus } from '../../lib/profileDetails';

interface ProfileResponse {
  profile: EmployeeProfile;
  authEmail: string | null;
}

interface SensitiveFormState {
  personal_identity_number: string;
  bank_account_name: string;
  bank_clearing_number: string;
  bank_account_number: string;
}

interface EditableProfileState {
  full_name: string;
  phone: string;
  private_email: string;
  address_line1: string;
  postal_code: string;
  city: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  clothing_size: string;
}

function toEditableState(profile: EmployeeProfile | null): EditableProfileState {
  return {
    full_name: profile?.full_name || '',
    phone: profile?.phone || '',
    private_email: profile?.private_email || '',
    address_line1: profile?.address_line1 || '',
    postal_code: profile?.postal_code || '',
    city: profile?.city || '',
    emergency_contact_name: profile?.emergency_contact_name || '',
    emergency_contact_phone: profile?.emergency_contact_phone || '',
    clothing_size: profile?.clothing_size || '',
  };
}

function emptySensitiveForm(): SensitiveFormState {
  return {
    personal_identity_number: '',
    bank_account_name: '',
    bank_clearing_number: '',
    bank_account_number: '',
  };
}

export default function ProfilePageClient() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<EmployeeProfile | null>(null);
  const [authEmail, setAuthEmail] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<EditableProfileState>(toEditableState(null));
  const [sensitiveStatus, setSensitiveStatus] = React.useState<EmployeeSensitiveStatus | null>(null);
  const [sensitiveForm, setSensitiveForm] = React.useState<SensitiveFormState>(emptySensitiveForm());
  const [sensitiveSaving, setSensitiveSaving] = React.useState(false);
  const [sensitiveError, setSensitiveError] = React.useState<string | null>(null);
  const [sensitiveSuccess, setSensitiveSuccess] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/profile', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Kunde inte ladda profilen.');
        }
        if (!active) return;
        const payload = data as ProfileResponse;
        setProfile(payload.profile);
        setAuthEmail(payload.authEmail);
        setForm(toEditableState(payload.profile));
        setSensitiveStatus(payload.profile.sensitive_status);
      } catch (fetchError: any) {
        if (!active) return;
        setError(fetchError?.message || 'Kunde inte ladda profilen.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function updateField(field: keyof EditableProfileState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setSuccess(null);
  }

  function updateSensitiveField(field: keyof SensitiveFormState, value: string) {
    setSensitiveForm((current) => ({ ...current, [field]: value }));
    setSensitiveError(null);
    setSensitiveSuccess(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Kunde inte spara profilen.');
      }
      if (data?.profile) {
        setProfile(data.profile);
        setForm(toEditableState(data.profile));
        setSensitiveStatus(data.profile.sensitive_status);
      }
      setSuccess('Profilen sparades.');
    } catch (submitError: any) {
      setError(submitError?.message || 'Kunde inte spara profilen.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSensitiveSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSensitiveSaving(true);
    setSensitiveError(null);
    setSensitiveSuccess(null);

    try {
      const res = await fetch('/api/profile/sensitive', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sensitiveForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Kunde inte spara de känsliga uppgifterna.');
      }
      if (data?.sensitiveStatus) {
        setSensitiveStatus(data.sensitiveStatus);
      }
      setSensitiveForm(emptySensitiveForm());
      setSensitiveSuccess('Löne- och identitetsuppgifterna sparades.');
    } catch (submitError: any) {
      setSensitiveError(submitError?.message || 'Kunde inte spara de känsliga uppgifterna.');
    } finally {
      setSensitiveSaving(false);
    }
  }

  return (
    <main style={pageStyle}>
      <section style={heroStyle}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={eyebrowStyle}>Min profil</span>
            {profile?.role && <span style={chipStyle}>Roll: {profile.role}</span>}
            <span style={mutedChipStyle}>{authEmail || 'Ingen e-post'}</span>
          </div>

          <div style={heroContentStyle}>
            <div style={{ display: 'grid', gap: 8, maxWidth: 720 }}>
              <h1 style={heroTitleStyle}>En renare överblick över din profil</h1>
              <p style={heroTextStyle}>
                Uppdatera dina kontaktuppgifter, se anställningsinformationen och komplettera känsliga uppgifter utan att allt känns lika tungt på en gång.
              </p>
            </div>

            <div style={heroMetaGridStyle}>
              <StatusTile
                label="Kontaktprofil"
                value={profile?.full_name ? 'Aktiv' : 'Behöver ses över'}
                tone={profile?.full_name ? 'good' : 'neutral'}
              />
              <StatusTile
                label="Anställningsdata"
                value={profile?.job_title || profile?.department || profile?.employment_type ? 'Registrerad' : 'Inväntar admin'}
                tone="neutral"
              />
              <StatusTile
                label="Löneuppgifter"
                value={sensitiveStatus?.has_bank_details || sensitiveStatus?.has_personal_identity_number ? 'Kompletterad' : 'Ej ifylld'}
                tone={sensitiveStatus?.has_bank_details || sensitiveStatus?.has_personal_identity_number ? 'good' : 'neutral'}
              />
            </div>
          </div>
        </div>
      </section>

      {loading && <section style={loadingCardStyle}>Laddar profil…</section>}
      {!loading && error && <section style={errorCardStyle}>{error}</section>}

      {!loading && profile && (
        <div style={layoutGridStyle}>
          <form onSubmit={handleSubmit} style={{ ...mainCardStyle, display: 'grid', gap: 18 }}>
            <div style={sectionHeaderStyle}>
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={sectionEyebrowStyle}>Egen uppdatering</span>
                <h2 style={sectionTitleStyle}>Kontakt och vardagsinfo</h2>
              </div>
              <p style={sectionTextStyle}>Den här delen använder du för sådant som ska vara enkelt att hålla aktuellt i vardagen.</p>
            </div>

            <div style={formGridStyle}>
              <Field label="Namn"><input value={form.full_name} onChange={(event) => updateField('full_name', event.target.value)} style={inputStyle} /></Field>
              <Field label="Telefon"><input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} style={inputStyle} /></Field>
              <Field label="Privat e-post"><input value={form.private_email} onChange={(event) => updateField('private_email', event.target.value)} style={inputStyle} /></Field>
              <Field label="Inloggningsmail"><input value={authEmail || ''} readOnly style={readOnlyInputStyle} /></Field>
              <Field label="Adress"><input value={form.address_line1} onChange={(event) => updateField('address_line1', event.target.value)} style={inputStyle} /></Field>
              <Field label="Postnummer"><input value={form.postal_code} onChange={(event) => updateField('postal_code', event.target.value)} style={inputStyle} /></Field>
              <Field label="Ort"><input value={form.city} onChange={(event) => updateField('city', event.target.value)} style={inputStyle} /></Field>
              <Field label="Klädstorlek"><input value={form.clothing_size} onChange={(event) => updateField('clothing_size', event.target.value)} style={inputStyle} /></Field>
              <Field label="Kontakt vid nödfall"><input value={form.emergency_contact_name} onChange={(event) => updateField('emergency_contact_name', event.target.value)} style={inputStyle} /></Field>
              <Field label="Telefon vid nödfall"><input value={form.emergency_contact_phone} onChange={(event) => updateField('emergency_contact_phone', event.target.value)} style={inputStyle} /></Field>
            </div>

            <div style={cardFooterStyle}>
              <div style={{ display: 'grid', gap: 4, minHeight: 18 }}>
                {error && <span style={{ color: '#b91c1c', fontSize: 13 }}>{error}</span>}
                {success && <span style={{ color: '#166534', fontSize: 13 }}>{success}</span>}
              </div>
              <button type="submit" disabled={saving} style={primaryButtonStyle}>{saving ? 'Sparar…' : 'Spara kontaktuppgifter'}</button>
            </div>
          </form>

          <div style={sideColumnStyle}>
            <section style={{ ...sideCardStyle, display: 'grid', gap: 14 }}>
              <div style={sectionHeaderStyle}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <span style={sectionEyebrowStyle}>Läsöversikt</span>
                  <h2 style={sectionTitleStyle}>Anställningsuppgifter</h2>
                </div>
                <p style={sectionTextStyle}>Visas för transparens men uppdateras av admin så att informationen håller ihop internt.</p>
              </div>

              <div style={compactInfoGridStyle}>
                <ReadOnlyField label="Titel" value={profile.job_title} compact />
                <ReadOnlyField label="Avdelning" value={profile.department} compact />
                <ReadOnlyField label="Ansvarig chef" value={profile.manager_name} compact />
                <ReadOnlyField label="Anställningsstart" value={profile.employment_start_date} compact />
                <ReadOnlyField label="Anställningsform" value={profile.employment_type} compact />
              </div>

              <ReadOnlyField label="Certifikat och behörigheter" value={profile.certifications} multiline />
            </section>

            <section style={{ ...sideCardStyle, display: 'grid', gap: 14 }}>
              <div style={sectionHeaderStyle}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <span style={sectionEyebrowStyle}>Separat säker del</span>
                  <h2 style={sectionTitleStyle}>Löne- och identitetsuppgifter</h2>
                </div>
                <p style={sectionTextStyle}>Här fyller du i känsliga uppgifter själv. Efter sparning visas de bara maskerat i profilen.</p>
              </div>

              <div style={compactInfoGridStyle}>
                <ReadOnlyField label="Personnummer" value={sensitiveStatus?.has_personal_identity_number ? sensitiveStatus.personal_identity_number_masked : 'Inte registrerat ännu'} compact />
                <ReadOnlyField label="Kontonamn" value={sensitiveStatus?.has_bank_details ? sensitiveStatus.bank_account_name_masked || 'Registrerat' : 'Inte registrerat ännu'} compact />
                <ReadOnlyField label="Kontonummer" value={sensitiveStatus?.has_bank_details ? sensitiveStatus.bank_account_number_masked || 'Registrerat' : 'Inte registrerat ännu'} compact />
                <ReadOnlyField label="Senast uppdaterat" value={formatTimestamp(sensitiveStatus?.sensitive_details_updated_at)} compact />
              </div>

              <form onSubmit={handleSensitiveSubmit} style={{ display: 'grid', gap: 12 }}>
                <div style={compactFormGridStyle}>
                  <Field label="Personnummer"><input value={sensitiveForm.personal_identity_number} onChange={(event) => updateSensitiveField('personal_identity_number', event.target.value)} style={inputStyle} /></Field>
                  <Field label="Kontonamn"><input value={sensitiveForm.bank_account_name} onChange={(event) => updateSensitiveField('bank_account_name', event.target.value)} style={inputStyle} /></Field>
                  <Field label="Clearingnummer"><input value={sensitiveForm.bank_clearing_number} onChange={(event) => updateSensitiveField('bank_clearing_number', event.target.value)} style={inputStyle} /></Field>
                  <Field label="Kontonummer"><input value={sensitiveForm.bank_account_number} onChange={(event) => updateSensitiveField('bank_account_number', event.target.value)} style={inputStyle} /></Field>
                </div>

                <div style={cardFooterStyle}>
                  <div style={{ display: 'grid', gap: 4, minHeight: 18 }}>
                    {sensitiveError && <span style={{ color: '#b91c1c', fontSize: 13 }}>{sensitiveError}</span>}
                    {sensitiveSuccess && <span style={{ color: '#166534', fontSize: 13 }}>{sensitiveSuccess}</span>}
                  </div>
                  <button type="submit" disabled={sensitiveSaving} style={secondaryButtonStyle}>{sensitiveSaving ? 'Sparar…' : 'Spara känsliga uppgifter'}</button>
                </div>
              </form>
            </section>
          </div>
        </div>
      )}
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

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'Inte uppdaterat ännu';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Registrerat';
  return date.toLocaleString('sv-SE');
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={fieldWrapperStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

function ReadOnlyField({ label, value, multiline = false, compact = false }: { label: string; value: string | null; multiline?: boolean; compact?: boolean }) {
  return (
    <div style={fieldWrapperStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      <div
        style={{
          ...readOnlyValueStyle,
          minHeight: multiline ? 84 : compact ? 40 : 46,
          alignItems: multiline ? 'flex-start' : 'center',
          padding: multiline ? '12px 13px' : compact ? '10px 12px' : '12px 14px',
        }}
      >
        {value || 'Inte angivet ännu'}
      </div>
    </div>
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

const loadingCardStyle: React.CSSProperties = {
  ...mainCardStyle,
  color: '#475569',
};

const errorCardStyle: React.CSSProperties = {
  ...mainCardStyle,
  borderColor: '#fecaca',
  color: '#b91c1c',
  background: '#fffafa',
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

const compactInfoGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
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

const readOnlyValueStyle: React.CSSProperties = {
  border: '1px solid #e6edf4',
  borderRadius: 10,
  padding: '12px 14px',
  fontSize: 13,
  color: '#0f172a',
  background: '#fbfcfe',
  display: 'flex',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
};

const cardFooterStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  paddingTop: 2,
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