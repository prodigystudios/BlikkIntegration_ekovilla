"use client";

import type { MouseEvent, ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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

export function RecentTable<T extends { id: string }>({ label, columns, rows, rowHref }: {
  label: string;
  columns: Array<RecentColumn<T>>;
  rows: T[];
  /** Vart ett klick på raden leder — samma mål som kundlänken i raden. */
  rowHref: (row: T) => string;
}) {
  const router = useRouter();

  // Hela raden är klickbar för musen och fingret, som när raderna var länkade kort. Tangentbordet
  // och skärmläsaren har kundlänken (ett tabbstopp per rad), så klickytan behöver ingen egen roll.
  // Ett klick PÅ länken sköter länken själv. Resten härmar en länk: Cmd/Ctrl/Shift och mittenknappen
  // öppnar en ny flik, och den som drar för att markera ett belopp eller nummer blir kvar på sidan.
  function onRowClick(event: MouseEvent<HTMLTableRowElement>, href: string) {
    if ((event.target as HTMLElement).closest('a')) return;
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    router.push(href);
  }

  function onRowAuxClick(event: MouseEvent<HTMLTableRowElement>, href: string) {
    if (event.button !== 1 || (event.target as HTMLElement).closest('a')) return;
    window.open(href, '_blank', 'noopener');
  }

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
        {/* 🧨 INGEN `relative` på raden och ingen länk vars ::after sträcks över den. Safari (även på
            datorn) bortser från position på <tr> — den beräknas som static — så överlägget hamnade på
            en förälder långt upp, och den sista radens länk täckte HELA sidan: varje klick öppnade
            samma arbetsorder. Chrome stöder relative på rader, så det syntes inte där. Rättat
            2026-10-06; därför onClick här. */}
        {rows.map((row) => (
          <tr
            key={row.id}
            onClick={(event) => onRowClick(event, rowHref(row))}
            onAuxClick={(event) => onRowAuxClick(event, rowHref(row))}
            className="cursor-pointer transition-colors hover:bg-white/70 has-[a:focus-visible]:bg-white/70"
          >
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
 * Radens länk, i kundcellen: ett tabbstopp per rad (raden själv tar musklicken, se RecentTable).
 * Fokusringen är appens (2 px --ek-accent, som globals.css) men ritas INÅT — en kontur utanför
 * länken kapades av kundcellens ellips (overflow: hidden). Raden ljusnar dessutom medan länken har fokus.
 */
export function RowLink({ href, title, children }: { href: string; title: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      title={title}
      className={cn(
        crm.link,
        'block break-words rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--ek-accent)] sm:truncate',
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
