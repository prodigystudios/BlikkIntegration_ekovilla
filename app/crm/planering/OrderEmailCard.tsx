'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/shared/cn';
import { useToast } from '@/lib/Toast';
import { crm } from '@/app/crm/lib/crmTokens';
import type { MaterialSupplier } from '@/lib/domains/planning/materialSuppliers';
import {
  DEFAULT_ORDER_EMAIL,
  ORDER_EMAIL_PLACEHOLDERS,
  ORDER_EMAIL_PLACEHOLDER_HELP,
  describeOrderEmailTemplateProblem,
  exampleOrderEmailData,
  orderEmailProblemField,
  renderOrderEmail,
  validateOrderEmailTemplate,
  type OrderEmailLanguage,
} from '@/lib/domains/planning/materialOrderEmail';

// Beställningsmailets mall för en leverantör: språk, ämne och text med platshållare, och en förhandsvisning.
//
// Eget utkast och egen spara-knapp, som StandardCrewEditor: leverantörspanelens "Spara" skickar hela raden
// (useEntityCrud toPayload) och får inte skriva över en mall som håller på att skrivas — och ett fel i
// mallen får inte hindra att ledtiden sparas.
//
// Reglerna (vilka platshållare som finns, vad som krävs, hur raderna skrivs) bor i materialOrderEmail.ts.
// Förhandsvisningen och servern renderar med SAMMA modul, så det som syns här är det som skickas.

const PANEL = 'rounded-2xl border border-[#e0e8dc] bg-white p-4';
const LABEL = 'mb-1.5 block text-[10.5px] font-bold uppercase tracking-wide text-slate-400';
const TEXTAREA =
  'w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-900 outline-none transition focus:border-[color:var(--ek-accent)] focus:ring-2 focus:ring-[color:var(--ek-accent-ring)]';
const API = '/api/crm/planering/material-suppliers';

const LANGUAGE_LABEL: Record<OrderEmailLanguage, string> = { sv: 'Svenska', en: 'Engelska' };

export default function OrderEmailCard({ supplier, onSaved }: { supplier: MaterialSupplier; onSaved: () => Promise<void> | void }) {
  const toast = useToast();
  const savedCustom = supplier.order_email_subject !== null && supplier.order_email_body !== null;

  const [language, setLanguage] = useState<OrderEmailLanguage>(supplier.order_email_language);
  const [custom, setCustom] = useState(savedCustom);
  const [subject, setSubject] = useState(supplier.order_email_subject ?? DEFAULT_ORDER_EMAIL[supplier.order_email_language].subject);
  const [body, setBody] = useState(supplier.order_email_body ?? DEFAULT_ORDER_EMAIL[supplier.order_email_language].body);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Läs om när den SPARADE mallen ändras (efter en sparning, eller ett annat val i listan som återanvänder
  // komponenten). Beroendena är de sparade värdena, inte objektet: en omrendering av föräldern med samma
  // mall får inte kasta ett osparat utkast.
  useEffect(() => {
    setLanguage(supplier.order_email_language);
    setCustom(supplier.order_email_subject !== null && supplier.order_email_body !== null);
    setSubject(supplier.order_email_subject ?? DEFAULT_ORDER_EMAIL[supplier.order_email_language].subject);
    setBody(supplier.order_email_body ?? DEFAULT_ORDER_EMAIL[supplier.order_email_language].body);
  }, [supplier.id, supplier.order_email_language, supplier.order_email_subject, supplier.order_email_body]);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<'subject' | 'body'>('body');

  // Med standardtext visas standarden för det VALDA språket — byter man språk byter texten med.
  const template = custom ? { subject, body } : DEFAULT_ORDER_EMAIL[language];
  const problems = useMemo(() => (custom ? validateOrderEmailTemplate({ subject, body }) : []), [custom, subject, body]);
  const preview = useMemo(
    () => renderOrderEmail(template, language, exampleOrderEmailData({ name: supplier.name, contactName: supplier.contact_name }, 'Ditt namn')),
    [template.subject, template.body, language, supplier.name, supplier.contact_name], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const dirty =
    language !== supplier.order_email_language ||
    custom !== savedCustom ||
    (custom && (subject !== supplier.order_email_subject || body !== supplier.order_email_body));

  const payload = () => ({
    order_email_language: language,
    order_email_subject: custom ? subject : null,
    order_email_body: custom ? body : null,
  });

  function startCustom() {
    // Utgå från standardtexten för det valda språket — att börja från ett tomt fält är att skriva om
    // något som redan fungerar.
    setSubject(DEFAULT_ORDER_EMAIL[language].subject);
    setBody(DEFAULT_ORDER_EMAIL[language].body);
    setCustom(true);
  }

  function insertPlaceholder(name: string) {
    const token = `{${name}}`;
    const field = lastFocused.current;
    const el = field === 'subject' ? subjectRef.current : bodyRef.current;
    const value = field === 'subject' ? subject : body;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    if (field === 'subject') setSubject(next);
    else setBody(next);
    // Markören efter den insatta platshållaren, så man kan skriva vidare.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    if (saving || problems.length > 0) return;
    setSaving(true);
    try {
      const r = await fetch(`${API}/${supplier.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const j = await r.json().catch(() => null);
      if (!j?.ok) return toast.error(j?.error || 'Kunde inte spara mallen');
      toast.success('Mallen sparad');
      await onSaved();
    } catch {
      toast.error('Kunde inte spara mallen');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (testing || problems.length > 0) return;
    setTesting(true);
    try {
      const r = await fetch(`${API}/${supplier.id}/test-mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const j = await r.json().catch(() => null);
      if (!j?.ok) return toast.error(j?.error || 'Kunde inte skicka testmailet');
      toast.success(`Testmail skickat till ${j.data.sent_to}`);
    } catch {
      // Utan grenen gav ett nätverksfel ingen återkoppling, och ett andra tryck skickar ett andra testmail.
      toast.error('Kunde inte skicka testmailet');
    } finally {
      setTesting(false);
    }
  }

  const subjectProblems = problems.filter((p) => orderEmailProblemField(p) === 'subject');
  const bodyProblems = problems.filter((p) => orderEmailProblemField(p) === 'body');

  return (
    <div className={cn(PANEL, 'xl:col-span-2')}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13.5px] font-extrabold text-[#142c1b]">Beställningsmail</h3>
        <span
          className={cn(
            'rounded-full border px-2 py-px text-[10.5px] font-bold',
            custom ? 'border-[#cfe3d6] bg-[#e7f0ea] text-[#1f4a2e]' : 'border-slate-200 bg-slate-50 text-slate-500',
          )}
        >
          {custom ? 'Egen text' : 'Standardtext'}
        </span>
      </div>
      <p className="mb-3 mt-0.5 text-[11.5px] text-slate-500">
        Mailet som går till {supplier.name} när ni beställer material. Beställningen — depå, leveransadress, material och
        antal — skrivs av systemet där <span className="font-semibold text-slate-600">{'{orderrader}'}</span> står, på
        leverantörens språk.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <span className={LABEL}>Språk</span>
          <div role="radiogroup" aria-label="Språk" className="inline-grid grid-flow-col gap-1 rounded-xl border border-[#e0e8dc] bg-[#f4f7f2] p-1">
            {(['sv', 'en'] as const).map((lang) => {
              const on = lang === language;
              return (
                <button
                  key={lang}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setLanguage(lang)}
                  className={cn('h-8 rounded-lg px-3 text-[12px] font-bold transition', on ? 'bg-[#1a3f26] text-white shadow-sm' : 'text-slate-600 hover:bg-white')}
                >
                  {LANGUAGE_LABEL[lang]}
                </button>
              );
            })}
          </div>
          {custom && language !== supplier.order_email_language && (
            <p className="mt-1.5 text-[11px] text-amber-700">
              Språket styr raderna, datumen och enheterna. Din egen text byter inte språk — skriv om den, eller återställ till
              standardtexten.
            </p>
          )}

          <div className="mt-3">
            <span className={LABEL}>Ämne</span>
            <input
              ref={subjectRef}
              value={template.subject}
              readOnly={!custom}
              onFocus={() => (lastFocused.current = 'subject')}
              onChange={(e) => setSubject(e.target.value)}
              className={cn(crm.input, !custom && 'bg-[#f9fbf7] text-slate-500')}
              aria-label="Ämne"
            />
            {subjectProblems.map((p, i) => (
              <p key={i} className="mt-1 text-[11px] text-rose-600">
                {describeOrderEmailTemplateProblem(p)}
              </p>
            ))}
          </div>

          <div className="mt-3">
            <span className={LABEL}>Text</span>
            <textarea
              ref={bodyRef}
              value={template.body}
              readOnly={!custom}
              onFocus={() => (lastFocused.current = 'body')}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              className={cn(TEXTAREA, !custom && 'bg-[#f9fbf7] text-slate-500')}
              aria-label="Text"
            />
            {bodyProblems.map((p, i) => (
              <p key={i} className="mt-1 text-[11px] text-rose-600">
                {describeOrderEmailTemplateProblem(p)}
              </p>
            ))}
          </div>

          {custom && (
            <div className="mt-2.5">
              <span className={LABEL}>Platshållare — klicka för att lägga in där markören står</span>
              <div className="flex flex-wrap gap-1.5">
                {ORDER_EMAIL_PLACEHOLDERS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    title={ORDER_EMAIL_PLACEHOLDER_HELP[name]}
                    // mousedown, inte click: fältet får inte tappa sin markering innan platshållaren läggs in.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertPlaceholder(name)}
                    className="rounded-full border border-[#e0e8dc] bg-[#f9fbf7] px-2 py-0.5 text-[11.5px] font-semibold text-slate-700 transition hover:border-[#c8d4c3] hover:bg-white"
                  >
                    {`{${name}}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {custom ? (
              <button type="button" onClick={() => setCustom(false)} className={crm.ghostButton}>
                Återställ till standardtext
              </button>
            ) : (
              <button type="button" onClick={startCustom} className={crm.ghostButton}>
                Anpassa texten
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty || problems.length > 0}
              className={crm.formButton}
              style={{ backgroundColor: 'var(--crm-primary)' }}
            >
              {saving ? 'Sparar…' : 'Spara mall'}
            </button>
            <button type="button" onClick={sendTest} disabled={testing || problems.length > 0} className={crm.ghostButton}>
              {testing ? 'Skickar…' : 'Skicka test till mig'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Testmailet går till din egen adress, med exempelrader och det som står i fälten just nu — även om det inte är
            sparat.
          </p>
        </div>

        <div className="min-w-0">
          <span className={LABEL}>Förhandsvisning — med exempelrader</span>
          {preview.ok ? (
            <div className="rounded-xl border border-[#e0e8dc] bg-[#fcfdfb] p-3.5">
              <div className="border-b border-[#eef3eb] pb-2 text-[12.5px] font-semibold text-slate-800">{preview.email.subject}</div>
              <div className="whitespace-pre-wrap break-words pt-2.5 text-[12.5px] leading-relaxed text-slate-700">{preview.email.text}</div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#dce4d8] bg-[#fcfdfb] p-3.5 text-[12px] text-slate-400">
              Förhandsvisningen visas när mallen är utan fel.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
