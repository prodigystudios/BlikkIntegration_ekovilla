"use client";

import { cn } from '@/lib/shared/cn';
import { formatCurrency } from '@/app/crm/lib/format';
import { ROW_OUTER, INNER_BASE, innerColumns } from './lineItemTable';
import { ROT_LABOR_ARTICLE_NUMBER, ROT_LABOR_DESCRIPTION } from '@/lib/domains/fortnox/types';

// Summeringen under artikelraderna och den genererade ROT-arbetsraden sist bland dem. Delade mellan
// offertformuläret och arbetsorderns artikeleditor, så de två läses likadant — se LineItemRow.

/**
 * Summeringen under raderna, som på en offert: delsumma, moms, totalt — och, med ROT, avdraget och
 * vad kunden betalar. Den stod förut som en remsa ovanför raderna; nu står summan där man läser
 * färdigt raderna (mockupen 2026-10-07), på offerten och arbetsordern lika.
 *
 * Totalen är ALLTID bruttot — det Fortnox visar som dokumentets summa. ROT-avdraget dras aldrig av
 * från den: det regleras mellan kunden och Skatteverket. Vad kunden betalar står som en egen, tydligt
 * märkt rad under.
 */
export function LineItemTotals({
  subtotal,
  vat,
  vatPercent,
  total,
  toPay,
  rotDeduction,
  reverseCharge = false,
  className,
}: {
  subtotal: number;
  vat: number;
  vatPercent: number;
  total: number;
  toPay: number;
  rotDeduction: number;
  /**
   * Omvänd skattskyldighet (byggmoms): momsen står som ett eget faktum i stället för "0 kr", och
   * totalen heter bara Totalt och är delsumman. Arbetsordern skickar det ur den
   * sparade prissättningen; offerten visar sin 0-procentsmoms som förut.
   */
  reverseCharge?: boolean;
  className?: string;
}) {
  return (
    <dl className={cn('m-0 grid w-full max-w-[22rem] gap-1.5 text-sm', className)}>
      <div className="flex justify-between gap-6 text-slate-600">
        <dt>Delsumma</dt>
        <dd className="m-0 tabular-nums">{formatCurrency(subtotal, 'SEK')}</dd>
      </div>
      <div className="flex justify-between gap-6 text-slate-600">
        <dt>Moms{reverseCharge ? '' : ` ${vatPercent} %`}</dt>
        <dd className={cn('m-0 tabular-nums', reverseCharge && 'font-medium text-amber-700')}>
          {reverseCharge ? 'Omvänd skattskyldighet' : formatCurrency(vat, 'SEK')}
        </dd>
      </div>
      {/* 🧨 Vid omvänd skattskyldighet är totalen DELSUMMAN, inte `total`. Arbetsordern avgör byggmomsen
          ur den sparade prissättningen, medan `total` räknas på order-raden momssats — och den har
          drivit iväg till 25 på byggmomsordrar. Då stod "Omvänd skattskyldighet" ovanför en total med
          25 % moms i. Fortnox fakturerar 0 %, så det är delsumman som gäller. */}
      <div className="flex justify-between gap-6 border-t border-[#e6ede3] pt-2 font-semibold text-slate-900">
        <dt>{reverseCharge ? 'Totalt' : 'Totalt inkl. moms'}</dt>
        <dd className="m-0 tabular-nums">{formatCurrency(reverseCharge ? subtotal : total, 'SEK')}</dd>
      </div>
      {rotDeduction > 0 ? (
        <>
          <div className="flex justify-between gap-6 font-medium text-emerald-700">
            <dt>Avgår ROT-avdrag</dt>
            <dd className="m-0 tabular-nums">−{formatCurrency(rotDeduction, 'SEK')}</dd>
          </div>
          <div className="flex justify-between gap-6 text-slate-600">
            <dt>Kunden betalar efter ROT</dt>
            <dd className="m-0 tabular-nums">{formatCurrency(toPay, 'SEK')}</dd>
          </div>
        </>
      ) : null}
    </dl>
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
  marginColumn = false,
  interactive = true,
}: {
  /** Radnumret den får — efter de riktiga raderna. */
  position: number;
  amount: number;
  /** Var raden skapas, för texten: "Fortnox-offerten" eller "Fortnox-ordern". */
  documentLabel?: string;
  /** Samma som tabellens (TG-kolumn, fäll ut-kolumn), så beloppet står i Belopp-kolumnen. */
  marginColumn?: boolean;
  interactive?: boolean;
}) {
  return (
    <div className={cn(ROW_OUTER, 'mt-1 rounded-lg bg-[#f1f6ef]')}>
      <span className="text-center text-xs font-semibold tabular-nums text-slate-400">{position}</span>
      <div className={cn(INNER_BASE, innerColumns(marginColumn, interactive), 'py-2.5')}>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-700">
            {ROT_LABOR_DESCRIPTION} <span className="font-normal text-slate-500">({ROT_LABOR_ARTICLE_NUMBER})</span>
          </span>
          <span className="block text-xs leading-snug text-slate-500">
            Skapas automatiskt på {documentLabel}. Utbruten ur raderna ovan, höjer inte summan.
          </span>
        </span>
        <span className="hidden md:block" />
        <span className="hidden md:block" />
        <span className="hidden md:block" />
        {marginColumn ? <span className="hidden md:block" /> : null}
        <span className="text-right text-sm tabular-nums text-slate-600">varav {formatCurrency(amount, 'SEK')}</span>
        {interactive ? <span className="hidden md:block" /> : null}
      </div>
    </div>
  );
}
