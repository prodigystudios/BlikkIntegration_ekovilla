import TidClient from './TidClient';
import { parseDateParam } from './dateParam';

// Tidrapporten. Sedan cutovern 2026-09-01 är det HIT menyn och startsidans genvägar pekar; Blikks
// gamla /tidrapport ligger kvar orörd som rutt men länkas inte längre från något håll.
//
// Tunn med flit: inloggning sköts av middleware, och åtkomsten till varje enskild rad avgörs av RLS
// (man ser och skriver sitt eget). Ingen rollgrind här — ALLA anställda ska rapportera tid, vilket
// är skillnaden mot gamla sidan som bara visades för member och admin.

export const dynamic = 'force-dynamic';

export default function TidPage({ searchParams }: { searchParams?: { datum?: string | string[] } }) {
  // Dagen kommer från genvägarna på startsidan och Mina jobb. Valideras i dateParam.ts.
  const initialDate = parseDateParam(searchParams?.datum);
  // `key` gör ett adressbyte till en OMMONTERING. Klienten läser datumet EN gång, som utgångsläge —
  // annars hade en navigering från ?datum=A till ?datum=B behållit A:s vecka på skärmen medan
  // adressfältet sa B. Samma fälla som egenkontrollens orderparameter kostade en gång.
  return <TidClient key={initialDate ?? 'idag'} initialDate={initialDate} />;
}
