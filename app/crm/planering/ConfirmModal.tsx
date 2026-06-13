'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import CrmModal from '@/app/crm/components/CrmModal';
import type { OpsSegment } from '@/lib/domains/planning/types';

const FIELD = cn(crm.input, 'disabled:bg-slate-50 disabled:text-slate-400');
const FORM_ID = 'planning-confirm-form';

// Send an order confirmation (orderbekräftelse) to the customer for a scheduled job. The recipient
// is prefilled from the CRM customer (GET prepare) and stays editable; email/SMS are independent.
export default function ConfirmModal({
  segment,
  onClose,
  onSent,
}: {
  segment: OpsSegment;
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const job = segment.job;

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [sendSms, setSendSms] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');

  const dateText = segment.start_day === segment.end_day ? segment.start_day : `${segment.start_day} – ${segment.end_day}`;

  // Prefill recipient from the CRM customer.
  useEffect(() => {
    let active = true;
    fetch(`/api/crm/planering/segments/${segment.id}/confirmation`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!active || !j.ok) return;
        const c = j.data.contact ?? {};
        setEmail(c.email || '');
        setPhone(c.phone || '');
        setSendEmail(Boolean(c.email));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [segment.id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sendEmail && !sendSms) {
      toast.error('Välj minst en kanal (mejl eller SMS).');
      return;
    }
    setSending(true);
    try {
      const r = await fetch(`/api/crm/planering/segments/${segment.id}/confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          send_email: sendEmail,
          recipient_email: email.trim() || null,
          send_sms: sendSms,
          recipient_phone: phone.trim() || null,
          custom_message: message.trim() || null,
        }),
      });
      const j = await r.json();
      if (!j.ok) {
        toast.error(j.error || 'Kunde inte skicka bekräftelsen');
        return;
      }
      const res = j.data.result as {
        email: { sent: boolean; recorded: boolean; error: string | null };
        sms: { sent: boolean; recorded: boolean; error: string | null };
      };
      // Hard failures = a channel that did NOT send. A channel that sent but couldn't be logged
      // (recorded=false) is surfaced as a warning so the planner doesn't re-send and double-notify.
      const hardErrors = [
        res.email?.error && !res.email?.sent && `Mejl: ${res.email.error}`,
        res.sms?.error && !res.sms?.sent && `SMS: ${res.sms.error}`,
      ].filter(Boolean);
      if (hardErrors.length) toast.error(hardErrors.join(' · '));
      if (res.email?.sent || res.sms?.sent) {
        const channels = [res.email?.sent && 'mejl', res.sms?.sent && 'SMS'].filter(Boolean).join(' + ');
        const unrecorded = (res.email?.sent && !res.email?.recorded) || (res.sms?.sent && !res.sms?.recorded);
        if (unrecorded) toast.error(`Skickat (${channels}), men kunde inte loggas — skicka INTE igen.`);
        else toast.success(`Bekräftelse skickad (${channels})`);
        onSent();
        onClose();
      }
    } catch {
      toast.error('Något gick fel vid utskicket');
    } finally {
      setSending(false);
    }
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Skicka orderbekräftelse"
      maxWidth="sm:max-w-[520px]"
      header={
        <div>
          <h2 className="text-[15px] font-bold text-slate-900">Skicka orderbekräftelse</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {job?.project_name ?? 'Order'} · {dateText}
          </p>
        </div>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={cn(crm.ghostButton, 'ml-auto')}>
            Avbryt
          </button>
          <button
            type="submit"
            form={FORM_ID}
            disabled={sending || loading || (!sendEmail && !sendSms)}
            className={crm.formButton}
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {sending ? 'Skickar…' : 'Skicka'}
          </button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="grid gap-4">
        {loading ? (
          <p className="flex items-center gap-2 rounded-lg border border-[#e0e8dc] bg-[#f3f6f1] px-3 py-2 text-[11.5px] text-slate-500">
            <svg className="h-3.5 w-3.5 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Hämtar kontaktuppgifter från kundkortet…
          </p>
        ) : (
          <p className="rounded-lg border border-[#e0e8dc] bg-[#f3f6f1] px-3 py-2 text-[11.5px] text-slate-500">
            Mottagaren hämtas från kundkortet i CRM. Kontrollera och justera vid behov innan du skickar.
          </p>
        )}

        {/* Email */}
        <div className="grid gap-1.5">
          <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} disabled={loading} className="h-4 w-4 accent-emerald-600" />
            Skicka mejl
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!sendEmail || loading}
            placeholder={loading ? 'Hämtar…' : 'kund@exempel.se'}
            className={FIELD}
          />
        </div>

        {/* SMS */}
        <div className="grid gap-1.5">
          <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
            <input type="checkbox" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} disabled={loading} className="h-4 w-4 accent-emerald-600" />
            Skicka SMS
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={!sendSms || loading}
            placeholder={loading ? 'Hämtar…' : '+46 70 123 45 67'}
            className={FIELD}
          />
        </div>

        {/* Optional custom message (email only) */}
        <div className="grid gap-1.5">
          <label className="text-[12px] font-semibold text-slate-500">Eget meddelande i mejlet (valfritt)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={!sendEmail}
            rows={3}
            placeholder="Lämna tomt för standardtext."
            className="w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-[13px] text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>
      </form>
    </CrmModal>
  );
}
