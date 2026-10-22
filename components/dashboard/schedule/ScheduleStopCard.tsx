"use client";
import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';
import { isSchedulePlaceholder, mapsSearchHref, projectRepeatsAddress, scheduleStopMeta, workdayPosition, workOrderHref } from '@/lib/domains/planning/scheduleStops';
import { materialPill } from './materialTheme';

// Ett stopp på bilens dag i startsidans arbetsschema.
//
// Samma kort för alla tre sorterna, som bara skiljer sig i vad de leder till:
// - CRM-jobb med arbetsorder → fältvyn (/arbetsorder/<id>?segment=…), som en riktig länk.
// - CRM-platshållare (service av maskiner, interna dagar) → ingenting. Beskrivningen är allt den har.
// - Äldre Blikk-rad → den befintliga detaljmodalen, via `onOpen`.
//
// ⚠️ INGEN role="button" PÅ KORTET. Ett kort med role="button" gör knapparna inuti det osynliga för
// skärmläsare — "Rapportera tid" fanns inte för den som navigerar med en. Kortytan är i stället ett
// vanligt klickområde för fingrarnas skull (inte fokuserbart, ingen roll), och tangentbordet når
// länken och knapparna, som är riktiga element. Den gamla `onKeyDown`-spärren (`e.target !==
// e.currentTarget`, så Enter på Tid-knappen inte öppnade ordern) behövs därför inte längre.
//
// Fakta som saknas döljs: inga nollor, streck eller platshållare. Säckar, rapporterat och team finns
// i dag bara på de äldre raderna; för CRM-jobben kommer de med fas 3 (ARBETSSCHEMA_KORT_REDESIGN_PLAN).

export type ScheduleStopRow = {
  source?: string;
  segment_id?: string | number | null;
  work_order_id?: string | null;
  order_number?: string | number | null;
  project_name?: string | null;
  customer?: string | null;
  address?: string | null;
  job_type?: string | null;
  job_day?: string | null;
  start_day?: string | null;
  end_day?: string | null;
  bag_count?: number | null;
  work_description?: string | null;
};

type Props = {
  row: ScheduleStopRow;
  /** Platsen på bilens rutt. null = utan lastbil. */
  stop: number | null;
  of: number;
  /** Sista stoppet på bilen — ruttlinjen ritas inte vidare under det. */
  last: boolean;
  compact: boolean;
  /** Rubriknivån under bilens rubrik: h4 i dagsvyn, h5 under hela veckans dagrubriker. */
  headingLevel: 4 | 5;
  reported: number;
  crewNames: string[];
  /** Mätnyckeln för platshållarens kapade beskrivning, se clippedKeys i DashboardSchedule. */
  clipKey: string;
  expanded: boolean;
  expandable: boolean;
  onToggleExpanded: () => void;
  /** Kortets klick: navigeringen till arbetsordern eller den äldre detaljmodalen (openDetail). */
  onOpen: () => void;
  onReportTime?: () => void;
};

export default function ScheduleStopCard({
  row, stop, of, last, compact, headingLevel, reported, crewNames, clipKey, expanded, expandable, onToggleExpanded, onOpen, onReportTime,
}: Props) {
  const isCrm = row.source === 'crm';
  // En publicerad platshållare har ingen arbetsorder och ingen Blikk-detaljvy — alltså ingenting att
  // öppna. Den fälls i stället ut på plats, men bara när något är kapat (se clippedKeys): annars ska
  // kortet inte SE ut som en knapp, för pekaren lovar en handling som inte finns.
  const isPlaceholder = isSchedulePlaceholder(row);
  const opens = !isPlaceholder;
  const href = workOrderHref(row);
  const sharesDay = stop != null && of >= 2;

  const address = (row.address || '').trim() || null;
  const heading = address || row.project_name || row.customer || 'Jobb utan namn';
  const workday = workdayPosition(row.job_day, row.start_day, row.end_day);
  const multiDay = !!row.start_day && !!row.end_day && row.start_day !== row.end_day;
  const material = isPlaceholder ? null : materialPill(row.job_type);

  const meta = scheduleStopMeta(row, stop, of);

  const subParts: ReactNode[] = [];
  if (row.customer && row.customer !== heading) subParts.push(row.customer);
  // Projektet efter adressen — utom när projektet bara ÄR adressen ("Strandgatan 9, Skutskär"), som
  // många gamla projekt heter. Då stod samma gata två gånger på två rader.
  if (address && row.project_name && !projectRepeatsAddress(row.project_name, address)) subParts.push(row.project_name);
  if (address) {
    subParts.push(
      <a
        href={mapsSearchHref(address)}
        target="_blank"
        rel="noopener noreferrer"
        // Negativ marginal: ett större träffområde för handskar utan att raden blir högre.
        className="-my-2 inline-block py-2 font-medium text-[#2f6b45] underline underline-offset-2 hover:text-[#1a3f26]"
      >
        Vägbeskrivning
        <span className="sr-only"> (öppnas i ny flik)</span>
      </a>,
    );
  }

  const bags = typeof row.bag_count === 'number' && row.bag_count > 0 ? row.bag_count : null;
  const reportedLabel = multiDay ? 'Rapporterat hela jobbet' : 'Rapporterat';
  const progress = bags && reported > 0 ? Math.min(100, (reported / bags) * 100) : null;
  const hasFacts = bags != null || reported > 0 || crewNames.length > 0;

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    // Länkarna och knapparna i kortet sköter sig själva. Utan spärren hade "Vägbeskrivning" öppnat
    // kartan i en ny flik OCH navigerat bort den här till arbetsordern.
    const hit = (e.target as Element).closest('a, button');
    if (hit && e.currentTarget.contains(hit)) return;
    // Slutet på en textmarkering är också ett klick. Den som markerar adressen för att kopiera den ska
    // inte hamna i arbetsordern, eller få kortet ihopfällt under sig. Bara en markering I DET HÄR
    // kortet: en kvarglömd markering någon annanstans (en lång tryckning på telefonen) hade annars
    // gjort varje kort på sidan dött tills den togs bort.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.anchorNode && e.currentTarget.contains(selection.anchorNode)) return;
    if (opens) onOpen();
    else if (expandable) onToggleExpanded();
  };

  // ⚠️ Huvudknappen grindas på ORDER-ID:t (workOrderHref), inte bara på källan. En CRM-rad kan sakna
  // arbetsorder sedan platshållare kan publiceras till entreprenaden
  // (supabase/archive/sql/20260908_ops_segments_field_visible.sql), och kortets klick (openDetail)
  // gör då ingenting — knappen hade lovat något den inte kan hålla.
  //
  // En riktig <a href>: hård navigering som förut (fältvyns "← Tillbaka" är history.back()), och
  // tangentbordet, mellanklick och "öppna i ny flik" fungerar som på vilken länk som helst.
  //
  // På mobilen är knappen en halv kortbredd (~170 px på en 375 px-telefon). "Öppna arbetsorder" ska stå
  // på EN rad där: tät padding, och pilen släpps på de smalaste skärmarna i stället för att texten bryts.
  const mainClass = cn(
    'inline-flex items-center justify-center whitespace-nowrap py-0 text-sm font-semibold text-white no-underline',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ek-accent)]',
    compact ? 'h-[52px] gap-1.5 rounded-none px-2 focus-visible:ring-inset max-[359px]:text-[13px]' : 'h-11 gap-2 rounded-xl border border-transparent px-4 focus-visible:ring-offset-2',
  );
  const arrow = <span className={cn('inline-flex', compact && 'max-[359px]:hidden')}><ArrowIcon /></span>;
  const main = href ? (
    <a href={href} className={cn(mainClass, 'bg-[#1a3f26] hover:bg-[#122c1b]')}>
      Öppna arbetsorder
      {arrow}
    </a>
  ) : !isCrm ? (
    <button type="button" onClick={onOpen} className={cn(mainClass, 'bg-[#1a3f26] hover:bg-[#122c1b]')}>
      Öppna jobb
      {arrow}
    </button>
  ) : null;

  // ⚠️ Knappen satt tidigare BARA på äldre rader (`!isCrmItem`), för att den då förifyllde ett
  // Blikk-projekt som ett CRM-jobb inte har. Sedan cutovern 2026-09-01 leder den till vår egen /tid,
  // och då är regeln precis omvänd: /tid väljer arbetsorder ur personens schemalagda CRM-jobb, alltså
  // är det just CRM-raderna knappen fungerar bäst för. Den visas på alla sorter — på en äldre rad finns
  // ingen order att välja, men dagen stämmer och tiden förs in som intern.
  //
  // `stopPropagation` är bärande: kortets eget klick navigerar till arbetsordern för en CRM-rad, och
  // utan det hade knappen gjort båda. (handleClick spärrar också, men den här ska inte hänga på den.)
  const secondary = onReportTime ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onReportTime(); }}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap bg-white py-0 text-sm font-semibold text-[#1a3f26] hover:bg-[#f4f7f2]',
        compact
          ? cn('h-[52px] gap-1.5 rounded-none border-0 px-2 focus-visible:outline-offset-[-3px] max-[359px]:text-[13px]', main && 'border-r border-[#e0e8dc]')
          : 'h-11 gap-2 rounded-xl border border-[#c6dccd] px-4',
      )}
    >
      <ClockIcon />
      Rapportera tid
    </button>
  ) : null;

  const metaRow = (
    <>
      {/* `grow`, inte `flex-1`: med basis 0 krympte metaraden på mobilen i stället för att låta
          etiketterna gå ned på en egen rad, och "Stopp 1 av 3 · AO-RT-013" bröts på tre rader.
          Delarna är egna radbrytningsled, så en smal skärm bryter MELLAN dem, aldrig inuti. */}
      {meta.length > 0 && (
        <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs font-semibold tabular-nums text-slate-600', compact && 'grow')}>
          {meta.map((part, i) => (
            <span key={part} className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
              {i > 0 && <span aria-hidden="true" className="text-[#c3cdc0]">·</span>}
              {part}
            </span>
          ))}
        </span>
      )}
      {workday && (
        <span className="inline-flex shrink-0 items-center rounded-full bg-[#ffedd5] px-[9px] py-[3px] text-xs font-semibold text-[#7c2d12]">
          Dag {workday.day} av {workday.of}
        </span>
      )}
      {material && (
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-[9px] py-[3px] text-xs font-semibold', material.className)}>
          <span aria-hidden="true" className={cn('h-[7px] w-[7px] rounded-full', material.dotClassName)} />
          {material.label}
        </span>
      )}
    </>
  );

  const Heading = headingLevel === 5 ? 'h5' : 'h4';
  const body = (
    <>
      <div>
        <Heading className={cn('m-0 break-words font-bold leading-tight tracking-[-0.01em] text-slate-900', compact ? 'text-lg' : 'text-[19px]')}>
          {heading}
        </Heading>
        {subParts.length > 0 && (
          <p className="m-0 mt-[3px] text-sm text-slate-600">
            {subParts.map((part, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden="true" className="mx-1.5 text-[#c3cdc0]">·</span>}
                {part}
              </span>
            ))}
          </p>
        )}
      </div>

      {/* Planerarens arbetsbeskrivning. En platshållare bär sin egen (service av maskiner, interna
          dagar) och en etapp ärver sin (placeSegment kopierar den: "bara vinden, inte snedtaket"),
          så den visas på båda sorterna — som på det gamla kortet.

          Bara platshållaren fälls ut. För den är texten det enda som säger vad dagen går ut på, och
          kortet leder inte till någon arbetsorder där den annars hade stått; utfälld behåller den
          raderna den skrevs med, som på /mina-jobb. Ett riktigt jobb öppnar arbetsordern, där hela
          texten står, så dess kort klipps bara (två rader, hela texten i `title`). */}
      {row.work_description && (
        <div className="grid justify-items-start gap-1">
          {/* Rutan och klippningen på VARSITT element: line-clamp klipper vid paddingkanten, så med
              paddingen på samma element syntes överkanten av en tredje rad under de två. */}
          <div className="w-full rounded-xl bg-[#f4f7f2] px-3.5 py-3">
            <div
              data-clip-key={isPlaceholder ? clipKey : undefined}
              title={expanded ? undefined : row.work_description}
              className={cn(
                'text-sm leading-normal text-slate-700',
                expanded ? 'whitespace-pre-wrap break-words' : 'line-clamp-2',
              )}
            >
              {row.work_description}
            </div>
          </div>
          {/* Utfällningen bärs av en riktig <button aria-expanded>, inte av kortet (se överst).
              `py-0`/`px-0`: annars ärver knappen globals.css `padding: 10px 14px`. stopPropagation:
              kortets eget klick hade annars fällt tillbaka. */}
          {expandable && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleExpanded(); }}
              aria-expanded={expanded}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border-0 bg-transparent px-0 py-0 text-sm font-semibold text-[#2f6b45]"
            >
              {expanded ? 'Visa mindre' : 'Visa hela texten'}
              <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={cn('transition-transform', expanded && 'rotate-180')}>
                <path fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}
        </div>
      )}

      {hasFacts && (compact ? (
        <>
          {(bags != null || reported > 0) && (
            <div className="grid grid-cols-2 gap-2">
              {bags != null && (
                <div className="rounded-xl bg-[#f4f7f2] px-3 py-2.5">
                  <div className="text-xs text-slate-600">Säckar</div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{bags}</div>
                </div>
              )}
              {reported > 0 && (
                <div className="rounded-xl bg-[#f4f7f2] px-3 py-2.5">
                  <div className="text-xs text-slate-600">{reportedLabel}</div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{reported}</div>
                  {progress != null && <Meter percent={progress} className="mt-1.5 h-1 w-full" />}
                </div>
              )}
            </div>
          )}
          {crewNames.length > 0 && <Team names={crewNames} />}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-slate-700">
          {/* Med mätaren säger "45 av 120 säckar" redan planen — då står säckarna inte två gånger. */}
          {bags != null && progress == null && (
            <span className="inline-flex items-center gap-1.5">
              <BagIcon />
              <b className="font-semibold tabular-nums">{bags}</b> säckar
            </span>
          )}
          {reported > 0 && (
            <span className="inline-flex items-center gap-2">
              {progress != null && <Meter percent={progress} className="h-1.5 w-[120px]" />}
              <span className="text-slate-600">{reportedLabel}</span>
              <b className="font-semibold tabular-nums">{bags ? `${reported} av ${bags} säckar` : `${reported} säckar`}</b>
            </span>
          )}
          {crewNames.length > 0 && <Team names={crewNames} />}
        </div>
      ))}
    </>
  );

  const surface = cn(
    'rounded-[18px] border bg-white',
    isPlaceholder ? 'border-dashed border-[#b9c8b4]' : 'border-[#e0e8dc]',
    (opens || expandable) && 'cursor-pointer',
    opens && 'transition-colors hover:border-[#c6dccd]',
  );

  if (compact) {
    return (
      <li>
        <div onClick={handleClick} className={cn(surface, 'overflow-hidden')}>
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <StopMarker stop={stop} sharesDay={sharesDay} placeholder={isPlaceholder} compact />
              {metaRow}
            </div>
            {body}
          </div>
          {(secondary || main) && (
            <div className={cn('grid border-t border-[#e0e8dc]', secondary && main ? 'grid-cols-2' : 'grid-cols-1')}>
              {secondary}
              {main}
            </div>
          )}
        </div>
      </li>
    );
  }

  return (
    <li className="flex gap-4">
      {/* Ruttlinjen binder ihop bilens stopp. Bara mellan numrerade stopp: jobben utan lastbil har
          ingen ordning att visa. */}
      <div aria-hidden="true" className="flex w-11 shrink-0 flex-col items-center pt-5">
        <StopMarker stop={stop} sharesDay={sharesDay} placeholder={isPlaceholder} compact={false} />
        {stop != null && !last && <span className="mt-1.5 w-0.5 flex-1 bg-[#c6dccd]" />}
      </div>
      <div className={cn('min-w-0 flex-1', !last && 'pb-3.5')}>
        <div onClick={handleClick} className={cn(surface, 'flex items-center gap-6 px-5 py-[18px]')}>
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">{metaRow}</div>
            {body}
          </div>
          {(secondary || main) && (
            <div className="flex w-[200px] shrink-0 flex-col gap-2">
              {main}
              {secondary}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Stoppsiffran. Det första stoppet är fyllt för att det är FÖRST — inte för att det är nästa, det
 * kräver en status kortet inte har än (öppen fråga 1 i planen).
 *
 * Platshållaren bär sin siffra när den delar dag med andra jobb (samma numrering som tavlan) och en
 * verktygsikon när den är ensam. Ett jobb utan lastbil har ingen plats i någon rutt: en neutral prick
 * på datorn så korten linjerar med de numrerade, ingenting på mobilen.
 */
function StopMarker({ stop, sharesDay, placeholder, compact }: { stop: number | null; sharesDay: boolean; placeholder: boolean; compact: boolean }) {
  const size = compact ? 'h-8 w-8 text-sm' : 'h-9 w-9 text-[15px]';
  const round = 'flex shrink-0 items-center justify-center rounded-full';
  if (placeholder && !sharesDay) {
    return (
      <span aria-hidden="true" className={cn(round, size, 'bg-[#f1f5f9] text-slate-600')}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" focusable="false">
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z" />
        </svg>
      </span>
    );
  }
  if (stop == null) {
    if (compact) return null;
    return (
      <span aria-hidden="true" className={cn(round, size)}>
        <span className="h-2.5 w-2.5 rounded-full bg-[#c6dccd]" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        round, size, 'font-bold tabular-nums',
        stop === 1 ? 'bg-[#1a3f26] text-white' : 'border-2 border-[#1a3f26] bg-white text-[#1a3f26]',
      )}
    >
      {stop}
    </span>
  );
}

// Dekorativ: siffrorna bredvid säger samma sak i text.
function Meter({ percent, className }: { percent: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-block overflow-hidden rounded-full bg-[#dfe7dc]', className)}>
      <span className="block h-full bg-[#2f6b45]" style={{ width: `${percent}%` }} />
    </span>
  );
}

function Team({ names }: { names: string[] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-700">
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <path d="M16 5a3 3 0 0 1 0 6" />
        <path d="M18 14a5 5 0 0 1 3 6" />
      </svg>
      <span className="sr-only">Team: </span>
      {names.join(', ')}
    </span>
  );
}

function BagIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 7h12l1 13H5z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="shrink-0">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="shrink-0">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}
