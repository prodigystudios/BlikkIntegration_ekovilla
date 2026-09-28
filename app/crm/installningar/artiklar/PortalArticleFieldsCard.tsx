"use client";

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/lib/Toast';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import {
  PORTAL_ARTICLE_CATEGORIES,
  PORTAL_ARTICLE_CATEGORY_LABELS,
  PORTAL_CUSTOMER_NAME_MAX,
  PORTAL_NOTE_MAX,
  PORTAL_PUBLISH_BLOCKER_LABELS,
  emptyPortalArticleFields,
  formatLaborSharePercent,
  parseLaborSharePercent,
  portalPublishBlockers,
  type PortalArticleCategory,
  type PortalArticleFields,
} from '@/lib/domains/portal/articleFields';

/** Det Fortnox säger om artikeln just nu. null = okänt (Fortnox är inte kopplat). */
export type PortalArticleFacts = {
  active: boolean;
  unit: string | null;
  /** Grundpriset på lista 160. null = inget pris. */
  resellerPrice: number | null;
};

type PortalArticleFieldsCardProps = {
  articleNumber: string;
  initialFields: PortalArticleFields | null;
  facts: PortalArticleFacts | null;
  /** Artikelns eget Spara navigerar bort; formuläret behöver veta om portalfälten har osparade ändringar. */
  onDirtyChange?: (dirty: boolean) => void;
};

type FormState = {
  publish: boolean;
  customer_name: string;
  category: '' | PortalArticleCategory;
  labor_share: string;
  note: string;
  sort_order: string;
};

function toForm(fields: PortalArticleFields): FormState {
  return {
    publish: fields.publish,
    customer_name: fields.customer_name,
    category: fields.category ?? '',
    labor_share: formatLaborSharePercent(fields.labor_share),
    note: fields.note,
    sort_order: String(fields.sort_order),
  };
}

function formatPrice(value: number): string {
  return value.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CARD =
  'rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]';

/**
 * Portalfälten på artikelsidan (RESELLER_PORTAL_CRM_PLAN.md fas 2a). Eget kort med eget Spara: fälten sparas i
 * CRM:et, inte i Fortnox, så de fungerar också när Fortnox-sparandet inte gör det.
 *
 * Vilken artikel som helst kan markeras. Kortet varnar för det som gör att publiceringen hoppar över den (inaktiv,
 * utan enhet, utan pris på lista 160), med samma regel som publiceringen använder.
 */
export default function PortalArticleFieldsCard({
  articleNumber,
  initialFields,
  facts,
  onDirtyChange,
}: PortalArticleFieldsCardProps) {
  const toast = useToast();
  const [saved, setSaved] = useState<PortalArticleFields>(() => initialFields ?? emptyPortalArticleFields(articleNumber));
  const [form, setForm] = useState<FormState>(() => toForm(saved));
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(toForm(saved)), [form, saved]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const laborShare = parseLaborSharePercent(form.labor_share);
  const sortOrder = /^\d{1,9}$/.test(form.sort_order.trim()) ? Number(form.sort_order.trim()) : null;
  const errors = {
    customer_name: form.publish && !form.customer_name.trim() ? 'Ange kundnamnet för att publicera artikeln.' : null,
    category: form.publish && !form.category ? 'Välj kategori för att publicera artikeln.' : null,
    labor_share: laborShare === null ? 'Ange 0–100, med högst en decimal.' : null,
    sort_order: sortOrder === null ? 'Ange ett heltal, 0 eller större.' : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const blockers = facts ? portalPublishBlockers(facts) : [];

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (hasErrors || laborShare === null || sortOrder === null) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/portal/article-fields/${encodeURIComponent(articleNumber)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publish: form.publish,
          customer_name: form.customer_name.trim(),
          category: form.category || null,
          labor_share: laborShare,
          note: form.note.trim(),
          sort_order: sortOrder,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Begäran misslyckades (${res.status})`);
      const fields = json.data.fields as PortalArticleFields;
      setSaved(fields);
      setForm(toForm(fields));
      setShowErrors(false);
      toast.success('Portalfälten sparade');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Kunde inte spara portalfälten');
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (message: string | null) =>
    showErrors && message ? <span className="text-xs font-medium text-red-700">{message}</span> : null;

  return (
    <section className={CARD} aria-labelledby="portal-fields-heading">
      <h2 id="portal-fields-heading" className="m-0 mb-1 text-base font-bold text-slate-900">
        Återförsäljarportalen
      </h2>
      <p className="m-0 mb-4 text-sm text-slate-500">Det butikerna ser i prislistan. Sparas i CRM:et, inte i Fortnox.</p>

      <div className="mb-4 rounded-xl border border-[#e0e8dc] bg-white px-3.5 py-3">
        <div className="text-xs font-semibold text-slate-500">Butikens inpris, lista 160</div>
        <div className="mt-0.5 text-sm font-semibold text-slate-900">
          {facts === null
            ? 'Okänt: anslut Fortnox för att se priset'
            : facts.resellerPrice === null
              ? 'Inget pris'
              : `${formatPrice(facts.resellerPrice)} kr${facts.unit?.trim() ? ` per ${facts.unit.trim().toLowerCase()}` : ''}`}
        </div>
      </div>

      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={form.publish}
          onChange={(e) => setField('publish', e.target.checked)}
          className="h-4 w-4 accent-[color:var(--ek-accent)]"
        />
        <span className="text-sm font-semibold text-slate-800">Med i prislistan</span>
      </label>

      {form.publish && blockers.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800" role="status">
          <p className="m-0 font-semibold">Kommer inte med när prislistan publiceras:</p>
          <ul className="m-0 mt-1 list-disc pl-5">
            {blockers.map((b) => (
              <li key={b}>{PORTAL_PUBLISH_BLOCKER_LABELS[b]}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-3.5">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700">Kundnamn</span>
          <Input
            value={form.customer_name}
            onChange={(e) => setField('customer_name', e.target.value)}
            maxLength={PORTAL_CUSTOMER_NAME_MAX}
            placeholder="t.ex. Lösull på vinden"
            aria-invalid={showErrors && Boolean(errors.customer_name)}
          />
          <span className="text-xs text-slate-400">Namnet slutkunden ser på offerten. Nämn inte Ekovilla.</span>
          {fieldError(errors.customer_name)}
        </label>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className="grid content-start gap-1.5">
            <span className="text-sm font-medium text-slate-700">Kategori</span>
            <Select
              value={form.category}
              onChange={(e) => setField('category', e.target.value as FormState['category'])}
              aria-invalid={showErrors && Boolean(errors.category)}
            >
              <option value="">—</option>
              {PORTAL_ARTICLE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PORTAL_ARTICLE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
            {fieldError(errors.category)}
          </label>

          <label className="grid content-start gap-1.5">
            <span className="text-sm font-medium text-slate-700">Arbetsandel (%)</span>
            <Input
              inputMode="decimal"
              value={form.labor_share}
              onChange={(e) => setField('labor_share', e.target.value)}
              placeholder="0"
              aria-invalid={showErrors && Boolean(errors.labor_share)}
            />
            <span className="text-xs text-slate-400">Den del av priset som är arbete och ger ROT.</span>
            {fieldError(errors.labor_share)}
          </label>
        </div>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700">Anteckning</span>
          <Textarea
            value={form.note}
            onChange={(e) => setField('note', e.target.value)}
            rows={2}
            maxLength={PORTAL_NOTE_MAX}
            className="min-h-[72px]"
            placeholder="Kort förtydligande i prislistan, får vara tom"
          />
        </label>

        <label className="grid gap-1.5 sm:max-w-[50%]">
          <span className="text-sm font-medium text-slate-700">Ordning</span>
          <Input
            inputMode="numeric"
            value={form.sort_order}
            onChange={(e) => setField('sort_order', e.target.value)}
            aria-invalid={showErrors && Boolean(errors.sort_order)}
          />
          <span className="text-xs text-slate-400">Lägst visas först i prislistan.</span>
          {fieldError(errors.sort_order)}
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {dirty && <span className="text-xs font-semibold text-amber-700">Ändringarna är inte sparade</span>}
        <Button variant="primary" onClick={handleSave} disabled={!dirty || busy}>
          {busy ? 'Sparar…' : 'Spara portalfälten'}
        </Button>
      </div>
    </section>
  );
}
