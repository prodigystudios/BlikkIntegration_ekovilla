"use client";

import { useCallback, useEffect, useState, type HTMLAttributes } from 'react';
import Input from '@/components/ui/Input';
import CrmModal from '@/app/crm/components/CrmModal';
import { crm } from '@/app/crm/lib/crmTokens';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import {
  PARTNER_INELIGIBLE_MESSAGES,
  PORTAL_PARTNER_TYPES,
  PORTAL_PARTNER_TYPE_LABELS,
  type InviteAdmin,
  type InviteStore,
  type PortalPartnerType,
} from '@/lib/domains/portal/partners';
// Bara typer ur databasdelen: den importerar serverns kö och klienter.
import type { PartnerStoreView, PortalPartnerView } from '@/lib/domains/portal/partnersStore';
import type { OutboxDelivery } from '@/lib/domains/portal/outboxDelivery';

/**
 * Rutan "Återförsäljarportalen" på kundkortet (RESELLER_PORTAL_CRM_PLAN.md 10a): flaggan, kortets företag i portalen
 * och inbjudan. Visas bara när integrationen är påslagen och användaren har crm.portal.manage (sidan avgör), och bara
 * på företagskort.
 */

type Dialog =
  | { mode: 'new'; resellerId: string; store: InviteStore; admin: InviteAdmin }
  | { mode: 'resend'; store: PartnerStoreView; admin: InviteAdmin; expectedAttempt: number };

type Tone = 'sent' | 'waiting' | 'refused' | 'none';

const RAIL: Record<Tone, string> = {
  sent: 'before:bg-emerald-500',
  waiting: 'before:bg-amber-400',
  refused: 'before:bg-rose-500',
  none: 'before:bg-slate-300',
};

const STATUS_TEXT: Record<Tone, string> = {
  sent: 'text-emerald-800',
  waiting: 'text-amber-800',
  refused: 'text-rose-700',
  none: 'text-slate-600',
};

const EMPTY_ADMIN: InviteAdmin = { name: '', email: '' };

function formatStockholm(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
}

function inviteStatus(store: PartnerStoreView): { tone: Tone; text: string } {
  const invite = store.invite;
  if (!invite) return { tone: 'none', text: 'Ingen inbjudan från CRM:et.' };
  const { delivery } = invite;
  switch (delivery.status) {
    case 'sent':
      return { tone: 'sent', text: `Inbjudan skickad ${formatStockholm(delivery.sentAt) ?? ''}`.trim() };
    case 'dead':
      return { tone: 'refused', text: invite.failure ?? 'Inbjudan gick inte fram till portalen.' };
    case 'not_queued':
      return { tone: 'none', text: 'Inbjudan är inte skickad.' };
    default: {
      const next = formatStockholm(delivery.nextAttemptAt);
      return { tone: 'waiting', text: next ? `Väntar på portalen. Nytt försök ${next}.` : 'Väntar på portalen.' };
    }
  }
}

async function request<T>(url: string, init: RequestInit): Promise<{ data: T } | { error: string }> {
  try {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) return { error: json?.error || `Begäran misslyckades (${res.status})` };
    return { data: json.data as T };
  } catch {
    return { error: 'Servern svarade inte. Försök igen.' };
  }
}

export default function PortalPartnerCard({ customerId }: { customerId: string }) {
  const toast = useToast();
  const [view, setView] = useState<PortalPartnerView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingType, setSavingType] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await request<{ partner: PortalPartnerView }>(`/api/crm/portal/partners/${customerId}`, { method: 'GET' });
    if ('error' in result) {
      setLoadError(result.error);
      return null;
    }
    setLoadError(null);
    setView(result.data.partner);
    return result.data.partner;
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeType(next: PortalPartnerType | null) {
    if (!view || savingType || next === view.partnerType) return;
    const previous = view.partnerType;
    setView({ ...view, partnerType: next });
    setSavingType(true);
    const result = await request<{ partnerType: PortalPartnerType | null }>(`/api/crm/portal/partners/${customerId}`, {
      method: 'PUT',
      body: JSON.stringify({ partnerType: next }),
    });
    setSavingType(false);
    if ('error' in result) {
      setView((v) => (v ? { ...v, partnerType: previous } : v));
      toast.error(result.error);
    }
  }

  function openNew() {
    if (!view) return;
    setFormError(null);
    setDialog({ mode: 'new', resellerId: globalThis.crypto.randomUUID(), store: { ...view.defaults }, admin: { ...EMPTY_ADMIN } });
  }

  function openResend(store: PartnerStoreView) {
    setFormError(null);
    setDialog({
      mode: 'resend',
      store,
      admin: store.invite ? { name: store.invite.adminName, email: store.invite.adminEmail } : { ...EMPTY_ADMIN },
      expectedAttempt: store.invite?.attempt ?? 0,
    });
  }

  async function submit() {
    if (!dialog || submitting) return;
    setSubmitting(true);
    setFormError(null);
    const body =
      dialog.mode === 'new'
        ? { mode: 'new', resellerId: dialog.resellerId, store: dialog.store, admin: dialog.admin }
        : { mode: 'resend', resellerId: dialog.store.resellerId, admin: dialog.admin, expectedAttempt: dialog.expectedAttempt };
    const result = await request<{ resellerId: string; delivery: OutboxDelivery | null }>(
      `/api/crm/portal/partners/${customerId}/invites`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    setSubmitting(false);
    if ('error' in result) {
      setFormError(result.error);
      return;
    }

    const email = dialog.admin.email.trim().toLowerCase();
    setDialog(null);
    const fresh = await load();
    const invite = fresh?.stores.find((s) => s.resellerId === result.data.resellerId)?.invite;
    const status = result.data.delivery?.status;
    if (status === 'sent') toast.success(`Inbjudan skickad till ${email}.`);
    else if (status === 'dead') toast.error(invite?.failure ?? 'Portalen nekade inbjudan.');
    else toast.success('Inbjudan är köad. Portalen svarade inte än, så den skickas igen automatiskt.');
  }

  const cardClass =
    'rounded-2xl border border-[#d6e3d1] bg-gradient-to-b from-[#f9fbf7] to-emerald-50/40 p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]';

  if (!view) {
    return (
      <section className={cardClass} aria-label="Återförsäljarportalen">
        <p className={cn('mb-3', crm.sectionTitle)}>Återförsäljarportalen</p>
        {loadError ? (
          <p className="text-xs text-rose-700">{loadError}</p>
        ) : (
          <div className="h-8 animate-pulse rounded-lg bg-[#dfe6da]" />
        )}
      </section>
    );
  }

  const canInvite = view.partnerType !== null && view.eligibility.ok;

  return (
    <section className={cardClass} aria-label="Återförsäljarportalen">
      <p className={cn('mb-3', crm.sectionTitle)}>Återförsäljarportalen</p>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Partnertyp">
        {[null, ...PORTAL_PARTNER_TYPES].map((type) => {
          const selected = view.partnerType === type;
          return (
            <button
              key={type ?? 'none'}
              type="button"
              aria-pressed={selected}
              disabled={savingType}
              onClick={() => changeType(type)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[13px] font-semibold transition disabled:opacity-60',
                selected
                  ? 'border-[color:var(--ek-green)] bg-[color:var(--ek-green)] text-white'
                  : 'border-[#e0e8dc] bg-white text-slate-600 hover:border-[#cfdcc9]',
              )}
            >
              {type ? PORTAL_PARTNER_TYPE_LABELS[type] : 'Ingen'}
            </button>
          );
        })}
      </div>

      {view.partnerType === null ? (
        <p className={cn('mt-3', crm.meta)}>Välj återförsäljare eller partner för att kunna bjuda in kunden till portalen.</p>
      ) : !view.eligibility.ok ? (
        <p className="mt-3 text-xs text-amber-800">{PARTNER_INELIGIBLE_MESSAGES[view.eligibility.reason]}</p>
      ) : null}

      {view.stores.length > 0 ? (
        <ul className="mt-4 grid gap-2" aria-label="Företag i portalen">
          {view.stores.map((store) => {
            const status = inviteStatus(store);
            return (
              <li
                key={store.resellerId}
                className={cn(
                  'relative overflow-hidden rounded-xl border border-slate-100 bg-white py-2.5 pl-4 pr-3',
                  "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
                  RAIL[status.tone],
                )}
              >
                <p className={cn('truncate', crm.bodyStrong)}>{store.name}</p>
                <p className={cn('truncate', crm.micro)}>
                  {[store.city, store.invite ? store.invite.adminEmail : null].filter(Boolean).join(', ')}
                </p>
                <p className={cn('mt-1 text-xs leading-snug', STATUS_TEXT[status.tone])}>{status.text}</p>
                {canInvite ? (
                  <button type="button" onClick={() => openResend(store)} className={cn('mt-1.5 p-0 text-xs', crm.link)}>
                    {store.invite ? 'Skicka inbjudan igen' : 'Bjud in en admin'}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {canInvite ? (
        <button
          type="button"
          onClick={openNew}
          className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl bg-[color:var(--ek-green)] text-sm font-semibold text-white shadow-sm transition hover:bg-[color:var(--ek-green-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent-ring)] active:scale-[0.98]"
        >
          Bjud in till portalen
        </button>
      ) : null}

      {dialog ? (
        <InviteDialog
          dialog={dialog}
          customerNumber={view.eligibility.ok ? view.eligibility.customerNumber : ''}
          submitting={submitting}
          error={formError}
          onChange={setDialog}
          onClose={() => (submitting ? undefined : setDialog(null))}
          onSubmit={submit}
        />
      ) : null}
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  inputMode,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className={cn('mb-1.5 block', crm.label)}>
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoFocus={autoFocus}
      />
    </div>
  );
}

function InviteDialog({
  dialog,
  customerNumber,
  submitting,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  dialog: Dialog;
  customerNumber: string;
  submitting: boolean;
  error: string | null;
  onChange: (dialog: Dialog) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const isNew = dialog.mode === 'new';
  const setStore = (patch: Partial<InviteStore>) => {
    if (dialog.mode === 'new') onChange({ ...dialog, store: { ...dialog.store, ...patch } });
  };
  const setAdmin = (patch: Partial<InviteAdmin>) => onChange({ ...dialog, admin: { ...dialog.admin, ...patch } });
  const title = isNew ? 'Bjud in till portalen' : dialog.store.invite ? 'Skicka inbjudan igen' : 'Bjud in en admin';
  const submitLabel = isNew ? 'Skicka inbjudan' : title;

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel={title}
      maxWidth="sm:max-w-[560px]"
      header={
        <>
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <p className={cn('mt-0.5', crm.pageSubtitle)}>
            {isNew
              ? `Företaget skapas i portalen med kundnummer ${customerNumber}. Adminen får ett mejl med en länk som gäller i 24 timmar och bjuder sedan in sina kollegor.`
              : `Till ${dialog.store.name}. Länken i mejlet gäller i 24 timmar. Har adminen redan valt lösenord skickas inget nytt mejl.`}
          </p>
        </>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-60 sm:flex-none sm:px-5"
          >
            Avbryt
          </button>
          <button
            type="submit"
            form="portal-invite-form"
            disabled={submitting}
            className="flex-1 rounded-xl bg-[color:var(--ek-green)] py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[color:var(--ek-green-strong)] disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
          >
            {submitting ? 'Skickar…' : submitLabel}
          </button>
        </>
      }
    >
      <form
        id="portal-invite-form"
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {dialog.mode === 'new' ? (
          <fieldset className="m-0 grid gap-3 border-0 p-0">
            <legend className={cn('mb-2 p-0', crm.groupTitle)}>Företaget i portalen</legend>
            <Field id="invite-name" label="Namn *" value={dialog.store.name} onChange={(name) => setStore({ name })} autoFocus />
            <Field id="invite-street" label="Gatuadress" value={dialog.store.street} onChange={(street) => setStore({ street })} autoComplete="street-address" />
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Field id="invite-postal" label="Postnummer" value={dialog.store.postalCode} onChange={(postalCode) => setStore({ postalCode })} autoComplete="postal-code" inputMode="numeric" />
              <Field id="invite-city" label="Ort *" value={dialog.store.city} onChange={(city) => setStore({ city })} autoComplete="address-level2" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="invite-phone" label="Telefon" value={dialog.store.phone} onChange={(phone) => setStore({ phone })} type="tel" inputMode="tel" />
              <Field id="invite-email" label="E-post" value={dialog.store.email} onChange={(email) => setStore({ email })} type="email" />
            </div>
          </fieldset>
        ) : null}

        <fieldset className="m-0 grid gap-3 border-0 p-0">
          <legend className={cn('mb-2 p-0', crm.groupTitle)}>{isNew ? 'Första admin' : 'Admin'}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="invite-admin-name" label="Namn *" value={dialog.admin.name} onChange={(name) => setAdmin({ name })} autoComplete="off" autoFocus={!isNew} />
            <Field id="invite-admin-email" label="E-post *" value={dialog.admin.email} onChange={(email) => setAdmin({ email })} type="email" autoComplete="off" />
          </div>
          <p className={crm.micro}>Ett konto i portalen hör till ett enda företag. Adressen kan inte redan vara admin någon annanstans.</p>
        </fieldset>

        {error ? (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        ) : null}
      </form>
    </CrmModal>
  );
}
