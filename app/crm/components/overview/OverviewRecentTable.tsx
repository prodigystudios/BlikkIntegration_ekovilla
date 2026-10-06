"use client";

import type { ReactNode } from 'react';
import Link from 'next/link';
import { DataTable, DataTableCell, DataTableHeaderCell } from '@/components/ui/DataTable';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

// Översiktens två tabeller, Senaste offerter och Senaste ordrar, på repots DataTable. Admins
// tabellutseende (ram, versala rubriker) åsidosätts med klasser, som AdminContacts gör: här ligger
// tabellen i ett kort och följer VD:ns mockup.

/** En kolumn: rubriken, bredden/synligheten (samma klass på <th> och <td>) och cellens innehåll. */
export type RecentColumn<T> = { header: string; className?: string; cell: (row: T) => ReactNode };

// Bredderna, samma i båda tabellerna så att de står i linje bredvid varandra. `table-fixed` tar
// bredden ur rubrikraden, och en dold kolumn måste döljas i varje rad — därför bor klassen i
// kolumnen och sätts på både rubrik och celler av RecentTable, aldrig för hand. Numret göms under
// 640 px och datumet under 768 px: på telefon räcker kund, belopp och status.
export const recentWidth = {
  // Bryts i stället för att kortas: ett osynkat ordernummer ('AO-20261005-3AA748', 18 tecken) är
  // det längsta, och de skiljer sig först i slutet — bindestrecken är brytpunkterna.
  number: 'hidden w-[6.5rem] break-words tabular-nums text-slate-500 sm:table-cell',
  name: '',
  // Smalare på telefon, så att kundnamnet får plats vid 360 px. "1 250 000 kr" ryms i båda.
  amount: 'w-[5.5rem] whitespace-nowrap text-right tabular-nums sm:w-[6.25rem]',
  date: 'hidden w-[5.75rem] whitespace-nowrap tabular-nums text-slate-500 md:table-cell',
  status: 'w-[6.75rem] text-right',
} as const;

export function RecentTable<T extends { id: string }>({ label, columns, rows }: {
  label: string;
  columns: Array<RecentColumn<T>>;
  rows: T[];
}) {
  return (
    <DataTable aria-label={label} className="table-fixed text-xs text-slate-700" containerClassName="rounded-none border-0">
      <thead>
        <tr>
          {columns.map((column) => (
            <DataTableHeaderCell
              key={column.header}
              scope="col"
              className={cn('px-0 pb-1.5 pr-3 pt-0 text-[11px] font-medium normal-case tracking-normal text-slate-500 last:pr-0', column.className)}
            >
              {column.header}
            </DataTableHeaderCell>
          ))}
        </tr>
      </thead>
      <tbody>
        {/* `relative` på raden: RowLink sträcker sin klickyta över den. */}
        {rows.map((row) => (
          <tr key={row.id} className="relative transition-colors hover:bg-white/70">
            {columns.map((column) => (
              <DataTableCell key={column.header} className={cn('border-[#eef2ec] px-0 py-2 pr-3 text-xs last:pr-0', column.className)}>
                {column.cell(row)}
              </DataTableCell>
            ))}
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/**
 * Radens länk. Den står i kundcellen men dess ::after täcker hela raden: ett tryck på beloppet eller
 * statusen landar också på posten, som när raderna var länkade kort — och det är fortfarande ett
 * tabbstopp per rad. Fokusringen ritas på ::after (inåt, så att tabellens kant inte klipper den),
 * inte på länken, vars egen ring kapades av kundcellens ellips.
 */
export function RowLink({ href, title, children }: { href: string; title: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      title={title}
      className={cn(
        crm.link,
        'block break-words outline-none after:absolute after:inset-0 after:rounded-md after:content-[""] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[color:var(--ek-accent-ring)] sm:truncate',
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Kunden och, under, projektet — det som skiljer en byggkunds ordrar åt när numret är dolt. Kunden
 * bryts på telefon, projektet kortas alltid till en rad (hela står i länkens title): båda brutna gav
 * fem rader höga tabellrader vid 360 px.
 */
export function CustomerCell({ href, customer, project }: { href: string; customer: string; project: string | null }) {
  return (
    <div className="min-w-0">
      <RowLink href={href} title={project ? `${customer} — ${project}` : customer}>{customer}</RowLink>
      {project ? <p className="m-0 truncate text-[11px] text-slate-500">{project}</p> : null}
    </div>
  );
}
