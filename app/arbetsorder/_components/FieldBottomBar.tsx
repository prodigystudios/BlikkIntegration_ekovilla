"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { ClockIcon, FIELD_FOCUS_RING, SackIcon } from './fieldUi';

/**
 * Sant medan ett TEXTFÄLT har fokus (kommentaren, säckformulärets antal, datumet).
 *
 * Då döljs knappraden: på iPhone lägger sig en fixerad bottenrad ovanpå tangentbordet och täcker
 * just det fält man skriver i. Knappar, chips och kryssrutor räknas inte — de öppnar inget tangentbord.
 *
 * `focusout` kommer FÖRE nästa `focusin`; läses fokus direkt där blinkar raden fram mellan två fält.
 * Därför läses det i nästa varv.
 *
 * 🧨 OCH ALDRIG MITT I ETT TRYCK. Fokus lämnar fältet redan vid NEDtryckningen (mousedown/pointerdown),
 * men klicket kommer först vid släppet. Kom raden tillbaka däremellan låg den under fingret när
 * släppet kom — och en "Spara rapport" som råkade stå där raden brukar sitta tog aldrig emot sitt
 * klick (hände i slutkontrollen 2026-11-03: formuläret stod kvar osparat). Därför väntar läsningen på
 * släppet när ett tryck pågår, och tar sitt varv efter klicket.
 *
 * ⚠️ GÄLLER `focusin` OCKSÅ. Chrome ger knappen man trycker på fokus redan vid nedtryckningen, och den
 * händelsen hade visat raden lika tidigt. Bara ett NYTT textfält får verka direkt — då ska raden bort.
 */
function useTextFieldFocused() {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const nonText = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color', 'image']);
    const isTextField = (el: Element | null) =>
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      (el instanceof HTMLInputElement && !nonText.has(el.type)) ||
      (el instanceof HTMLElement && el.isContentEditable);
    const update = () => setFocused(isTextField(document.activeElement));
    let timer = 0;
    let pressing = false;
    let readAfterPress = false;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 0);
    };
    const onPointerDown = () => { pressing = true; };
    const onPointerUp = () => {
      pressing = false;
      if (readAfterPress) {
        readAfterPress = false;
        // Klicket skickas efter pointerup i samma varv — nästa varv är efter klicket.
        schedule();
      }
    };
    const onFocusOut = () => {
      if (pressing) readAfterPress = true;
      else schedule();
    };
    const onFocusIn = () => {
      if (isTextField(document.activeElement)) {
        window.clearTimeout(timer);
        readAfterPress = false;
        setFocused(true);
      } else if (pressing) readAfterPress = true;
      else schedule();
    };
    // Capture: ett kort som stoppar spridningen på sina egna tryck får inte lämna raden dold.
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, []);
  return focused;
}

type Props = {
  /** Tid-knappen. Döljs för den som har Tid-fliken — se nedan. */
  showTime: boolean;
  /** Säckknappen. Döljs när egenkontrollen är inlämnad: då är jobbet avräknat (hasFinal). */
  showSacks: boolean;
  /** Fram med säckkortet och öppna det befintliga formuläret. Inget nytt formulär här. */
  onReportSacks: () => void;
};

/**
 * Fältvyns fasta knapprad: Tid och Rapportera säckar — de två saker dagen slutar med.
 *
 * TID. Länken går till vår egen tidrapport, som listar personens schemalagda CRM-jobb för dagen,
 * alltså den här ordern. Den ersätter den gula rutan "Tidrapportering" (som förklarade samma sak i
 * text). Utan datum med flit: fältvyn vet inte vilken dag placeringen gäller, och /tid öppnar på i dag
 * — dagen man rapporterar (William 2026-11-03). Döljs för den som HAR Tid-fliken: två vägar till
 * tidrapporteringen som pekar åt olika håll är värre än en. Se `canReportTime` i page.tsx.
 *
 * SÄCKAR. Ingen egen rapportyta — knappen scrollar till säckkortet och fäller ut formuläret där.
 *
 * Inget att visa (egenkontrollen inlämnad OCH Tid-fliken öppen) = ingen rad alls.
 *
 * z-30: samma nivå som offertformulärets spar-rad. Felrapportknappen (z-25) lyfts ovanför raden på
 * /arbetsorder i stället för att täckas — se ReportIssueLauncher.
 */
export default function FieldBottomBar({ showTime, showSacks, onReportSacks }: Props) {
  const typing = useTextFieldFocused();
  if (!showTime && !showSacks) return null;

  const button = 'inline-flex h-[52px] min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] px-3 py-0 text-[15px] font-semibold no-underline';
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-0 border-t border-solid border-[color:var(--ui-border-subtle)] bg-white px-4 pt-3',
        'pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]',
        typing && 'hidden',
      )}
    >
      {/* 2:3 och inte hälften var: "Rapportera säckar" ska stå på EN rad på en 390 px-telefon, och
          "Tid" behöver inte mer än sin ikon och sitt ord. */}
      <div className={cn('mx-auto grid max-w-2xl gap-2', showTime && showSacks ? 'grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : 'grid-cols-1')}>
        {/* ⚠️ Tid är en LÄNK (navigerar), säckarna en KNAPP (gör något här). En <button> med
            router.push hade tappat mittenklick och "öppna i ny flik". */}
        {showTime ? (
          <Link
            href="/tid"
            className={cn(button, 'border border-solid border-[color:var(--ek-accent-soft-border)] bg-white text-[color:var(--ek-green)]', FIELD_FOCUS_RING)}
          >
            <ClockIcon />
            Tid
          </Link>
        ) : null}
        {showSacks ? (
          <button
            type="button"
            onClick={onReportSacks}
            className={cn(button, 'border-0 bg-[var(--ek-green)] text-white', FIELD_FOCUS_RING, 'focus-visible:ring-offset-2')}
          >
            <SackIcon />
            Rapportera säckar
          </button>
        ) : null}
      </div>
    </div>
  );
}
