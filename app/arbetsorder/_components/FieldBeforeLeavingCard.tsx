import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { ChecklistIcon, ChevronRightIcon, FIELD_CARD, FIELD_FOCUS_RING, FIELD_SECTION_TITLE } from './fieldUi';

type Props = {
  /** orderLookupRef — RÅTT nummer, aldrig documentRef. null = inget att slå upp på. */
  lookupNumber: string | null;
  /** documentRef, bara för texten. */
  orderRef: string;
};

/**
 * "Innan ni åker" — egenkontrollen, med ordernumret ifyllt. Innan detta fick installatören lämna
 * ordern, leta upp Egenkontroll i menyn och skriva av numret hen just tittade på.
 *
 * Skyddsronden hör INTE hit: den görs av chefer och arbetsledare, inte av besättningen innan de åker
 * (William 2026-11-03). Den har sitt eget kort, bara för den som har en skyddsrondsnyckel.
 *
 * Raden visar ingen status ("Ej gjord"/"Gjord"). Inget svarar på den frågan i dag: `hasFinal` bevisar
 * bara att en egenkontroll MED säckrader finns, aldrig att ingen finns, och på en etappuppdelad order
 * gäller den hela ordern.
 */
export default function FieldBeforeLeavingCard({ lookupNumber, orderRef }: Props) {
  return (
    <section className={cn(FIELD_CARD, 'grid gap-3')} aria-labelledby="field-before-leaving-title">
      <h2 id="field-before-leaving-title" className={FIELD_SECTION_TITLE}>Innan ni åker</h2>
      {lookupNumber ? (
        <>
          {/* ⚠️ LÄNKAR, INTE KNAPPAR. Båda navigerar. En <button onClick={router.push}> hade sett
              likadan ut men tappat mittenklick, "öppna i ny flik" och skärmläsarens länkroll — och den
              som fyller i en egenkontroll vill ofta ha arbetsordern kvar i en flik bredvid. */}
          <Link
            href={`/egenkontroll?orderId=${encodeURIComponent(lookupNumber)}`}
            className={cn('flex min-h-[52px] items-center gap-3 rounded-xl bg-[var(--ui-surface-muted)] px-3.5 py-2 text-slate-900 no-underline', FIELD_FOCUS_RING)}
          >
            <span className="inline-flex text-[color:var(--ek-green)]"><ChecklistIcon /></span>
            <span className="grid min-w-0 flex-1">
              <span className="text-[15px] font-semibold">Gör egenkontroll</span>
              <span className="text-[13px] text-slate-600">Kund, adress och etapper hämtas från order {orderRef}</span>
            </span>
            <span className="inline-flex text-slate-500"><ChevronRightIcon /></span>
          </Link>
          {/* ⚠️ "Sök i arkivet", inte "egenkontrollen för den här ordern". Arkivet filtrerar på
              FILNAMNET, som bär det nummer installatören skrev in när rapporten lämnades — med raden
              ovan blir det alltid det här numret, men äldre filer kan bära det andra (internt kontra
              Fortnox). Länken får inte lova en exakthet den inte har.

              Den visas ALLTID, aldrig gömd bakom sackReports.hasFinal: en egenkontroll utan säckrader
              skriver inga final-rader alls, så hasFinal === false bevisar inte att ingen egenkontroll
              finns. Arkivet svarar självt "Inga matchande resultat". */}
          <Link
            href={`/archive?q=${encodeURIComponent(lookupNumber)}`}
            className="-my-1 inline-flex min-h-11 w-fit items-center text-sm font-semibold text-[color:var(--ek-accent)] underline underline-offset-2"
          >
            Sök i arkivet efter den här ordern
          </Link>
        </>
      ) : (
        // Utan nummer skulle båda länkarna garanterat landa på "Ordern hittades inte" respektive ett
        // tomt arkiv. Säg det i stället för att erbjuda en väg som inte finns.
        <p className="m-0 text-sm leading-relaxed text-slate-600">
          Ordern saknar ordernummer, så egenkontrollen kan inte hämta jobbet automatiskt. Öppna{' '}
          <strong className="font-semibold">Ny egenkontroll</strong> i menyn och fyll i uppgifterna för hand.
        </p>
      )}
    </section>
  );
}
