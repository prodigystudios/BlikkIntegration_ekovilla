"use client";

import { useMemo, useState } from 'react';
import CrmModal from '@/app/crm/components/CrmModal';
import Input from '../../../components/ui/Input';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import { lineItemQuantity } from '@/lib/domains/crm/lineItems';
import { lineItemEffectiveUnitPrice } from '@/lib/domains/crm/pricing';
import { parseDecimal } from '@/lib/shared/number';
import { formatCurrency } from '@/app/crm/lib/format';

export type PartialInvoiceLine = { index: number; quantity: number };

type LineItem = {
  article_name?: string | null;
  article_number?: string | null;
  article_unit_name?: string | null;
  line_note?: string | null;
  unit_price?: string | null;
  article_price?: number | null;
  discount_percent?: string | null;
  pricing_mode?: 'm3' | 'item' | string | null;
  quantity?: string | null;
  m2?: string | null;
  thickness_mm?: string | null;
};

type InvoiceRound = { line_quantities: PartialInvoiceLine[] | null };

const roundQty = (n: number) => Math.round(n * 1e6) / 1e6;
const fmtQty = (n: number) => String(Math.round(n * 1000) / 1000);

// Per-article delfakturering: enter how much of each line to invoice now. Defaults each line to
// its remaining quantity, clamps input to [0, remaining], shows a live subtotal, and submits only
// the lines with a positive quantity. Mirrors the server's computeInvoiceState exactly.
export default function WorkOrderPartialInvoiceModal({
  lineItems,
  rounds,
  currencyCode,
  submitting,
  onClose,
  onSubmit,
}: {
  lineItems: LineItem[];
  rounds: InvoiceRound[];
  currencyCode: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (lines: PartialInvoiceLine[]) => void;
}) {
  const state = useMemo(
    () =>
      lineItems.map((item, index) => {
        const total = roundQty(lineItemQuantity(item));
        const invoiced = roundQty(
          rounds.reduce(
            (sum, r) => sum + ((r.line_quantities ?? []).find((q) => q.index === index)?.quantity ?? 0),
            0,
          ),
        );
        return { index, item, total, invoiced, remaining: Math.max(0, roundQty(total - invoiced)) };
      }),
    [lineItems, rounds],
  );

  const [inputs, setInputs] = useState<Record<number, string>>(() =>
    Object.fromEntries(state.map((s) => [s.index, s.remaining > 0 ? fmtQty(s.remaining) : '0'])),
  );

  const billed = state.map((s) => {
    const requested = Math.max(0, parseDecimal(inputs[s.index] ?? '0'));
    const quantity = Math.min(s.remaining, roundQty(requested));
    return { ...s, quantity, amount: quantity * lineItemEffectiveUnitPrice(s.item) };
  });

  const grandTotal = billed.reduce((sum, b) => sum + b.amount, 0);
  const anyPositive = billed.some((b) => b.quantity > 0);
  const anyRemaining = state.some((s) => s.remaining > 0);

  function submit() {
    onSubmit(billed.filter((b) => b.quantity > 0).map((b) => ({ index: b.index, quantity: b.quantity })));
  }

  return (
    <CrmModal
      onClose={onClose}
      ariaLabel="Delfakturera arbetsorder"
      maxWidth="sm:max-w-[680px]"
      header={
        <div>
          <p className={crm.pageTitle}>Delfakturera</p>
          <p className="mt-0.5 text-xs text-slate-500">Ange hur mycket av varje artikel som ska faktureras nu. Resten kan faktureras senare.</p>
        </div>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className={cn(crm.ghostButton, 'ml-auto')} disabled={submitting}>
            Avbryt
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !anyPositive}
            className={cn(crm.saveButton, 'h-9 w-auto px-4')}
          >
            {submitting ? 'Skapar…' : 'Skapa delfaktura'}
          </button>
        </>
      }
    >
      <div className="grid gap-2">
        {state.length === 0 ? (
          <p className={crm.emptyValue}>Arbetsordern saknar artiklar att fakturera.</p>
        ) : !anyRemaining ? (
          <p className={crm.emptyValue}>Allt är redan fakturerat på den här ordern.</p>
        ) : (
          billed.map((b) => {
            const name = b.item.article_name || b.item.line_note || 'Artikel';
            const unit = b.item.article_unit_name || '';
            const done = b.remaining <= 0;
            return (
              <div
                key={b.index}
                className={cn(
                  'grid gap-2 rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] p-3 sm:grid-cols-[1fr,auto]',
                  done && 'opacity-60',
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Totalt {fmtQty(b.total)} {unit} · Fakturerat {fmtQty(b.invoiced)} · Kvar {fmtQty(b.remaining)} {unit}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <div className="w-24">
                    <Input
                      inputMode="decimal"
                      value={inputs[b.index] ?? ''}
                      disabled={done || submitting}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [b.index]: e.target.value }))}
                      aria-label={`Fakturera nu (${name})`}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm tabular-nums text-slate-700">
                    {formatCurrency(b.amount, currencyCode)}
                  </span>
                </div>
              </div>
            );
          })
        )}

        {anyRemaining ? (
          <div className="mt-1 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
            <span className="text-sm font-semibold text-emerald-800">Delsumma att fakturera (ex moms)</span>
            <strong className="text-sm tabular-nums text-emerald-900">{formatCurrency(grandTotal, currencyCode)}</strong>
          </div>
        ) : null}
      </div>
    </CrmModal>
  );
}
