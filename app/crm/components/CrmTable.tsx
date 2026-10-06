"use client";

import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DataTable, DataTableCell, DataTableHeaderCell } from '@/components/ui/DataTable';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

// CRM:ets listtabell, på repots DataTable: översiktens Senaste offerter och Senaste ordrar, och
// listsidorna Offerter och Arbetsorder. Admins tabellutseende (ram, versala rubriker) åsidosätts med
// klasser, som AdminContacts gör: tabellen ligger i ett kort och följer VD:ns mockup.

/** En kolumn: rubriken, bredden/synligheten (samma klass på <th> och <td>) och cellens innehåll. */
export type CrmTableColumn<T> = { header: string; className?: string; cell: (row: T) => ReactNode };

/**
 * Två täthetsgrader av samma tabell. `compact` är översiktens kort, där två tabeller står bredvid
 * varandra; `regular` är listsidorna, där tabellen har hela bredden och läses rad för rad.
 *
 * `table-fixed` tar bredden ur rubrikraden, och en dold kolumn måste döljas i varje rad — därför bor
 * bredd- och synlighetsklassen i kolumnen och sätts på både rubrik och celler här, aldrig för hand.
 */
export type CrmTableSize = 'compact' | 'regular';

const sizeClass: Record<CrmTableSize, { table: string; header: string; cell: string }> = {
  compact: {
    table: 'table-fixed text-xs text-slate-700',
    header: 'px-0 pb-1.5 pr-3 pt-0 text-[11px] font-medium normal-case tracking-normal text-slate-500 last:pr-0',
    cell: 'border-[#eef2ec] px-0 py-2 pr-3 text-xs last:pr-0',
  },
  regular: {
    table: 'table-fixed text-[13px] text-slate-700',
    header: 'px-0 pb-2 pr-4 pt-0 text-xs font-medium normal-case tracking-normal text-slate-500 last:pr-0',
    cell: 'border-[#eef2ec] px-0 py-2.5 pr-4 text-[13px] last:pr-0',
  },
};

// Cellernas egna andrarader (projektet under kunden) följer tabellens täthet utan att varje
// anropare behöver skicka med den.
const SizeContext = createContext<CrmTableSize>('compact');

/** Andraradens textstorlek i en cell — projektet under kunden, momsbasen under beloppet. */
export function useCrmTableDetailText() {
  return useContext(SizeContext) === 'regular' ? 'text-xs' : 'text-[11px]';
}

export function CrmTable<T extends { id: string }>({ label, size, columns, rows, rowHref, onOpenRow }: {
  label: string;
  size: CrmTableSize;
  columns: Array<CrmTableColumn<T>>;
  rows: T[];
  /** Radens adress — samma mål som länken i raden. Cmd/Ctrl/Shift och mittenknappen öppnar den i ny flik. */
  rowHref: (row: T) => string;
  /**
   * Öppnar raden på plats i stället för att navigera, som offertlistans panel. Ett vanligt klick på
   * raden går hit; länken i raden behöver samma beteende (RowLink `onOpen`).
   */
  onOpenRow?: (row: T) => void;
}) {
  const router = useRouter();
  const classes = sizeClass[size];

  // Hela raden är klickbar för musen och fingret, som när raderna var länkade kort. Tangentbordet
  // och skärmläsaren har länken i raden (ett tabbstopp per rad), så klickytan behöver ingen egen roll.
  // Ett klick PÅ länken sköter länken själv. Resten härmar en länk: Cmd/Ctrl/Shift och mittenknappen
  // öppnar en ny flik, och den som drar för att markera ett belopp eller nummer blir kvar på sidan.
  function onRowClick(event: MouseEvent<HTMLTableRowElement>, row: T) {
    if ((event.target as HTMLElement).closest('a')) return;
    if (window.getSelection()?.toString()) return;
    const href = rowHref(row);
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    if (onOpenRow) onOpenRow(row);
    else router.push(href);
  }

  function onRowAuxClick(event: MouseEvent<HTMLTableRowElement>, href: string) {
    if (event.button !== 1 || (event.target as HTMLElement).closest('a')) return;
    window.open(href, '_blank', 'noopener');
  }

  return (
    <SizeContext.Provider value={size}>
      <DataTable aria-label={label} className={classes.table} containerClassName="rounded-none border-0">
        <thead>
          <tr>
            {columns.map((column) => (
              <DataTableHeaderCell key={column.header} scope="col" className={cn(classes.header, column.className)}>
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
              onClick={(event) => onRowClick(event, row)}
              onAuxClick={(event) => onRowAuxClick(event, rowHref(row))}
              className="cursor-pointer transition-colors hover:bg-white/70 has-[a:focus-visible]:bg-white/70"
            >
              {columns.map((column) => (
                <DataTableCell key={column.header} className={cn(classes.cell, column.className)}>
                  {column.cell(row)}
                </DataTableCell>
              ))}
            </tr>
          ))}
        </tbody>
      </DataTable>
    </SizeContext.Provider>
  );
}

/**
 * Radens länk, i kundcellen: ett tabbstopp per rad (raden själv tar musklicken, se CrmTable).
 * Fokusringen är appens (2 px --ek-accent, som globals.css) men ritas INÅT — en kontur utanför
 * länken kapades av kundcellens ellips (overflow: hidden). Raden ljusnar dessutom medan länken har fokus.
 *
 * `onOpen` gör ett vanligt klick (och Enter) till "öppna på plats", som tabellens `onOpenRow`.
 * Cmd/Ctrl/Shift/Alt och mittenknappen lämnas åt webbläsaren: adressen öppnas då i en ny flik, precis
 * som för en vanlig länk. Next:s Link navigerar inte när klicket redan är `defaultPrevented`.
 *
 * Listsidorna (`regular`) förladdar inte: med hundra rader per sida hade varje rad som rullar in
 * kostat ett serveranrop, och kortlistan de ersatte förladdade ingenting (raderna var knappar).
 * Översiktens tio rader förladdar som förut.
 */
export function RowLink({ href, title, onOpen, children }: { href: string; title: string; onOpen?: () => void; children: ReactNode }) {
  const size = useContext(SizeContext);
  return (
    <Link
      href={href}
      title={title}
      prefetch={size === 'regular' ? false : undefined}
      onClick={onOpen ? (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpen();
      } : undefined}
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
export function CustomerCell({ href, customer, project, onOpen }: { href: string; customer: string; project: string | null; onOpen?: () => void }) {
  const detailText = useCrmTableDetailText();
  return (
    <div className="min-w-0">
      <RowLink href={href} title={project ? `${customer} — ${project}` : customer} onOpen={onOpen}>{customer}</RowLink>
      {project ? <p className={cn('m-0 truncate', detailText, 'text-slate-500')}>{project}</p> : null}
    </div>
  );
}
