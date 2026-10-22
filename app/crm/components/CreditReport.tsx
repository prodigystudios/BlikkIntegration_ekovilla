// Shared presentation of a tic.io credit report (kreditupplysning). `CreditReportSummary` is the
// customer detail card's full view; the new-customer form builds a compact preview from the
// helpers below, so the score/risk/remarks wording lives in one place. Pure presentational — the
// fetch/persist logic stays in each caller.

import { cn } from '@/lib/shared/cn';
import { formatDate } from '@/app/crm/lib/format';
import type { TicCreditReport } from '@/lib/domains/tic/types';

function formatSek(value: number | null | undefined): string {
  if (value == null) return '–';
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(value)} kr`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return '–';
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 }).format(value)} %`;
}

// tic.io credit score 0–100 → badge colour (higher = better).
export function creditScoreMeta(score: number | null): { badge: string; text: string } {
  if (score == null) return { badge: 'border-slate-200 bg-slate-50', text: 'text-slate-600' };
  if (score >= 75) return { badge: 'border-emerald-200 bg-emerald-50', text: 'text-emerald-700' };
  if (score >= 50) return { badge: 'border-green-200 bg-green-50', text: 'text-green-700' };
  if (score >= 25) return { badge: 'border-amber-200 bg-amber-50', text: 'text-amber-700' };
  return { badge: 'border-rose-200 bg-rose-50', text: 'text-rose-700' };
}

// tic.io risk class 1–5 (5 = lowest risk) → badge colour + fallback label.
export function riskClassMeta(cls: number | null): { label: string; badge: string } {
  switch (cls) {
    case 5: return { label: 'Mycket låg risk', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
    case 4: return { label: 'Låg risk', badge: 'border-green-200 bg-green-50 text-green-700' };
    case 3: return { label: 'Medelrisk', badge: 'border-amber-200 bg-amber-50 text-amber-700' };
    case 2: return { label: 'Förhöjd risk', badge: 'border-orange-200 bg-orange-50 text-orange-700' };
    case 1: return { label: 'Hög risk', badge: 'border-rose-200 bg-rose-50 text-rose-700' };
    default: return { label: 'Okänd risk', badge: 'border-slate-200 bg-slate-50 text-slate-600' };
  }
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-700">{value}</p>
    </div>
  );
}

function debtorLine(rec: { number_of_cases: number; total_amount_sek: number; last_case_date: string | null }): string {
  const base = `${rec.number_of_cases} st · ${formatSek(rec.total_amount_sek)}`;
  return rec.last_case_date ? `${base} · senast ${formatDate(rec.last_case_date)}` : base;
}

/** Riskklassens text: tic.io:s egen formulering när den finns, annars vår etikett för klassen. */
export function creditRiskLabel(report: TicCreditReport): string {
  return report.risk_description || riskClassMeta(report.risk_class).label;
}

/** Riskprognosen som procent ("12,5 %"), eller null när tic.io inte skickat någon prognos. */
export function creditForecastPercent(report: TicCreditReport): string | null {
  return report.risk_forecast != null ? formatPercent(report.risk_forecast) : null;
}

/** "Riskprognos (sannolikhet): 12,5 %", eller null när tic.io inte skickat någon prognos. */
export function creditForecastText(report: TicCreditReport): string | null {
  const percent = creditForecastPercent(report);
  return percent ? `Riskprognos (sannolikhet): ${percent}` : null;
}

/**
 * Betalningsförelägganden, -anmärkningar och skuldsaldo som rader. Tom lista = inget registrerat.
 * Anmärkningar och skuldsaldo kommer bara med en högre tic.io-licens (Max) — raderna dyker upp av
 * sig själva om den höjs.
 */
export function creditRemarkLines(report: TicCreditReport): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  if (report.payment_applications) lines.push({ label: 'Betalningsförelägganden', value: debtorLine(report.payment_applications) });
  if (report.non_payment) lines.push({ label: 'Betalningsanmärkningar', value: debtorLine(report.non_payment) });
  if (report.debt_balance_sek != null) lines.push({ label: 'Skuldsaldo (Kronofogden)', value: formatSek(report.debt_balance_sek) });
  return lines;
}

export function CreditReportSummary({ report }: { report: TicCreditReport }) {
  const scoreMeta = creditScoreMeta(report.credit_score);
  const riskMeta = riskClassMeta(report.risk_class);
  const remarks = creditRemarkLines(report);
  const forecast = creditForecastText(report);

  return (
    <div className="grid gap-5">
      {/* Betyg + riskklass */}
      <div className="flex flex-wrap items-stretch gap-3">
        <div className={cn('flex min-w-[110px] flex-col justify-center rounded-xl border px-4 py-3', scoreMeta.badge)}>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Kreditbetyg</p>
          <p className={cn('mt-0.5 text-2xl font-bold tabular-nums', scoreMeta.text)}>
            {report.credit_score != null ? report.credit_score : '–'}
            {report.credit_score != null ? <span className="text-sm font-semibold text-slate-400"> / 100</span> : null}
          </p>
        </div>
        <div className="flex flex-col justify-center gap-1.5">
          <span className={cn('inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold', riskMeta.badge)}>
            {creditRiskLabel(report)}
          </span>
          {forecast ? <p className="text-xs text-slate-500">{forecast}</p> : null}
        </div>
      </div>

      {/* Betalningsförelägganden / -anmärkningar / skuldsaldo */}
      {remarks.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {remarks.map((line) => <InfoField key={line.label} label={line.label} value={line.value} />)}
        </div>
      ) : (
        <p className="text-xs text-slate-500">Inga betalningsanmärkningar eller skulder registrerade.</p>
      )}

      <p className="text-[11px] text-slate-400">Källa: tic.io · kan skilja från andra kreditbyråer</p>
    </div>
  );
}
