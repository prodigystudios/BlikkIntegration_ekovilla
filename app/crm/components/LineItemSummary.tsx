"use client";

import { cn } from '@/lib/shared/cn';
import { formatCurrency } from '@/app/crm/lib/format';
import { ROT_LABOR_ARTICLE_NUMBER, ROT_LABOR_DESCRIPTION } from '@/lib/domains/fortnox/types';

// Summeringen ovanför artikelraderna och den genererade ROT-arbetsraden under dem. Delade mellan
// offertformuläret och arbetsorderns artikeleditor, så de två läses likadant — se LineItemRow.

const eyebrow = 'text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400';

export function LineItemTotalsBar({
  subtotal,
  vat,
  vatPercent,
  total,
  toPay,
  rowCount,
  carvedLabor,
  rotDeduction,
  isPrivate,
  className,
}: {
  subtotal: number;
  vat: number;
  vatPercent: number;
  total: number;
  toPay: number;
  /** Antal ifyllda (debiterbara) rader. */
  rowCount: number;
  carvedLabor: number;
  rotDeduction: number;
  isPrivate: boolean;
  className?: string;
}) {
  // VAT display convention (agreed with finance): private leads with the price INCL moms;
  // business leads with the EX-moms figure, the moms shown in the breakdown.
  //
  // The headline is ALWAYS the gross value — the figure Fortnox shows as the document total. A ROT
  // deduction is NOT subtracted from the headline: ROT is settled between the customer and
  // Skatteverket, so the company's value is still the gross. The customer's net-after-ROT (`toPay`)
  // is shown as a clearly-labelled secondary line, never as the headline.
  const headlineLabel = isPrivate ? 'Total inkl. moms' : 'Belopp ex moms';
  const headlineAmount = isPrivate ? total : subtotal;

  return (
    <div className={cn('mb-6 flex items-center gap-8 rounded-xl bg-slate-50 px-5 py-4', className)}>
      <div className="grid gap-0.5">
        <span className={eyebrow}>Delsumma</span>
        <span className="text-sm font-semibold text-slate-900">{formatCurrency(subtotal, 'SEK')}</span>
      </div>
      <div className="grid gap-0.5">
        <span className={eyebrow}>Moms ({vatPercent} %)</span>
        <span className="text-sm font-semibold text-slate-900">{formatCurrency(vat, 'SEK')}</span>
      </div>
      <div className="grid gap-0.5">
        <span className={eyebrow}>Rader</span>
        <span className="text-sm font-semibold text-slate-900">{rowCount} st</span>
      </div>
      {/* Labour carved out of the material rows (each row's "Varav arbetskostnad"), which is
          summed into one "Arbetskostnad ROT" row (art. 10058) on the Fortnox document. Shown here
          with the other line totals so all prices sit in one place. */}
      {carvedLabor > 0 ? (
        <div className="grid gap-0.5">
          <span className={eyebrow}>Arbetskostnad ROT</span>
          <span className="text-sm font-semibold text-emerald-700">{formatCurrency(carvedLabor, 'SEK')}</span>
        </div>
      ) : null}
      {rotDeduction > 0 ? (
        <div className="grid gap-0.5">
          <span className={eyebrow}>Avgår ROT</span>
          <span className="text-sm font-semibold text-emerald-700">−{formatCurrency(rotDeduction, 'SEK')}</span>
        </div>
      ) : null}
      <div className="ml-auto grid gap-0.5 text-right">
        <span className={eyebrow}>{headlineLabel}</span>
        <span className="text-base font-bold text-slate-950">{formatCurrency(headlineAmount, 'SEK')}</span>
        {isPrivate && rotDeduction > 0 ? (
          <span className="text-[11px] text-slate-400">Kund betalar efter ROT {formatCurrency(toPay, 'SEK')}</span>
        ) : !isPrivate ? (
          <span className="text-[11px] text-slate-400">Inkl. moms {formatCurrency(total, 'SEK')}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Den genererade arbetskostnadsraden.
 *
 * Ligger ALLTID sist, som på Fortnox-dokumentet: pushen lägger den efter artikelraderna. Den är
 * läsvy och finns inte bland raderna — den syntetiseras först vid pushen (rotLaborRow) och får
 * aldrig lagras som en riktig rad. Gjorde vi det skulle pushen bryta ut arbetet EN GÅNG TILL ovanpå
 * den och dubbelräkna det.
 *
 * ⚠️ Beloppet är INTE ett tillägg. Det är redan utbrutet ur raderna ovan, som visas till sitt fulla
 * pris här medan Fortnox-dokumentet visar dem sänkta med samma belopp — summan är densamma på båda
 * hållen. Därför "Varav" och ingen egen summering: den som adderar radbeloppen i huvudet ska inte
 * landa på en annan siffra än Delsumman.
 *
 * Visas bara när något faktiskt bryts ut. Rader med "ROT-arbete" ikryssad går INTE hit — de blir
 * egna husarbete-rader med sin egen artikel, precis som i pushen.
 */
export function GeneratedRotLaborRow({
  position,
  amount,
  documentLabel = 'Fortnox-offerten',
}: {
  /** Radnumret den får — efter de riktiga raderna. */
  position: number;
  amount: number;
  /** Var raden skapas, för texten: "Fortnox-offerten" eller "Fortnox-ordern". */
  documentLabel?: string;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-3.5 py-2.5">
      <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-600/60">{position}</span>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-sm font-medium text-emerald-900">
          {ROT_LABOR_DESCRIPTION} <span className="font-normal text-emerald-700/70">({ROT_LABOR_ARTICLE_NUMBER})</span>
        </p>
        <p className="m-0 text-[11px] leading-snug text-emerald-700/70">
          Skapas automatiskt på {documentLabel}. Beloppet är redan utbrutet ur raderna ovan.
        </p>
      </div>
      <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-emerald-900">
        <span className="mr-1 text-[11px] font-normal text-emerald-700/70">Varav</span>
        {formatCurrency(amount, 'SEK')}
      </span>
    </div>
  );
}
