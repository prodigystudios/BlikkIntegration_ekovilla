import TidClient from './TidClient';

// CRM-versionen av tidrapporten. Ligger bredvid gamla /tidrapport (som fortsätter mot Blikk) tills
// cutovern i fas 4.6 — samma mönster som "Planering" och "Planering (äldre)" under den förra
// cutovern, så ingen behöver byta arbetssätt förrän allt är avstämt.
//
// Tunn med flit: inloggning sköts av middleware, och åtkomsten till varje enskild rad avgörs av RLS
// (man ser och skriver sitt eget). Ingen rollgrind här — ALLA anställda ska rapportera tid, vilket
// är skillnaden mot gamla sidan som bara visades för member och admin.

export const dynamic = 'force-dynamic';

export default function TidPage() {
  return <TidClient />;
}
