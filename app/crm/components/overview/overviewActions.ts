import { daysSince } from '@/lib/shared/relativeTime';

export type OverviewAction = { title: string; description: string; href: string };

/** Samtalsloggen har legat stilla: hur många dygn. Null = läsaren har aldrig loggat ett eget. */
export type StaleCalls = { days: number | null };

/**
 * Har samtalsloggen legat stilla i sju dagar? Samtalsloggen SKA användas — att den ligger stilla
 * är säljarnas slarv, inte en död funktion. Flyttad hit ur kortet Senaste samtal när det togs bort.
 *
 * Utlösaren är serverns callsLast7Days, räknad på HELA det synliga urvalet. Är den noll har ingen
 * som läsaren ser loggat något på sju dagar — och för en säljare ingår hen själv i det, så båda
 * formuleringarna i staleCallsAction är sanna oavsett vem som läser.
 *
 * Inget synligt samtal alls ger ingen rad, som förut: annars hade den som aldrig ringer i tjänsten
 * (konsult, en admin utan säljroll i ett tomt CRM) fått påminnelsen för evigt.
 *
 * Dygnen räknades förut ur översiktens fem senaste samtal, och föll den egna raden utanför de fem
 * blev det "över en vecka". Tidsstämplarna kommer nu ur summeringen, så det finns ingen blind fläck.
 */
export function staleCalls(args: {
  callsLast7Days: number;
  lastVisibleCallAt: string | null;
  lastOwnCallAt: string | null;
  /** Läsaren ser hela lagets samtal (crm.admin) — samma nyckel som styr vad API:t lämnar ut. */
  seesWholeTeam: boolean;
  now?: number;
}): StaleCalls | null {
  if (args.callsLast7Days > 0 || args.lastVisibleCallAt == null) return null;
  return { days: daysSince(args.seesWholeTeam ? args.lastVisibleCallAt : args.lastOwnCallAt, args.now) };
}

// Urvalet är RLS-filtrerat: en admin ser allas samtal, alla andra sina egna plus kollegors på
// prospekt de äger. Påståendet måste följa med — "ingen har loggat" vore fel när det bara betyder
// att DU inte har det.
function staleCallsAction(stale: StaleCalls, seesWholeTeam: boolean): OverviewAction {
  const title = seesWholeTeam
    ? `Ingen har loggat ett samtal på ${stale.days != null ? `${stale.days} dagar` : 'över en vecka'}`
    : stale.days != null
      ? `Du har inte loggat ett samtal på ${stale.days} dagar`
      : 'Du har inte loggat något samtal ännu';
  return {
    title,
    description: 'Logga samtalen när de görs — veckans tavla räknar bara det som står i loggen.',
    href: '/crm/samtal?log=1',
  };
}

// Rubrikerna räknas upp i singular vid 1. Neutrum-substantiv (samtal, prospekt) har samma
// form i båda numerus, men adjektiven och t-orden runt dem har det inte — "1 fristående
// samtal ligger öppna" — så hela frasen står i varje gren. Samtalsraden behöver ingen gren:
// "samtal" böjs inte och svenska presensverb böjs inte efter numerus.
//
// Ordningen är prioriteten: det som redan är sent, det som blir sent i dag, en logg som legat
// stilla, sedan uppföljningarna. Alla rader visas — taket på tre togs bort när räknaren kom, för en
// siffra vid rubriken läses som "så här mycket finns", och en kapad lista hade gjort den till en
// lögn. I praktiken är det högst fem: den stilla loggen och de två samtalsraderna utesluter varandra
// (när loggen står still är veckans samtal noll), och prospektraden är strukturellt tom
// (PIPELINE_PROSPECT_STATUSES i overviewSummary.ts).
export function buildOverviewActions(args: {
  overdueTasks: number;
  todayTasks: number;
  followUpCalls: number;
  newProspects: number;
  standaloneCalls: number;
  quoteFollowUps: number;
  staleCalls: StaleCalls | null;
  seesWholeTeam: boolean;
}): OverviewAction[] {
  const actions: OverviewAction[] = [];

  if (args.overdueTasks > 0) {
    actions.push({ title: `${args.overdueTasks} ${args.overdueTasks === 1 ? 'uppgift är sen' : 'uppgifter är sena'}`, description: 'Börja med att stänga sådant som redan borde ha följts upp.', href: '/crm/uppgifter' });
  }
  // Dagens uppgifter stod i kortet Öppna uppgifter. Utan den här raden hade de syntes först i
  // morgon, som sena.
  if (args.todayTasks > 0) {
    actions.push({ title: `${args.todayTasks} ${args.todayTasks === 1 ? 'uppgift förfaller' : 'uppgifter förfaller'} i dag`, description: 'Stäng dem innan dagen är slut, så att de inte blir liggande.', href: '/crm/uppgifter' });
  }
  if (args.staleCalls) {
    actions.push(staleCallsAction(args.staleCalls, args.seesWholeTeam));
  }
  if (args.followUpCalls > 0) {
    actions.push({ title: `${args.followUpCalls} samtal behöver nästa steg`, description: 'Logga uppföljning eller konvertera till prospekt om signalen är varm.', href: '/crm/samtal' });
  }
  if (args.quoteFollowUps > 0) {
    actions.push({ title: `${args.quoteFollowUps} ${args.quoteFollowUps === 1 ? 'offertläge' : 'offertlägen'} väntar uppföljning`, description: 'Stäm av prospekt där offerten behöver nästa steg innan affären tappar fart.', href: '/crm/offerter' });
  }
  if (args.newProspects > 0) {
    actions.push({ title: `${args.newProspects} ${args.newProspects === 1 ? 'nytt prospekt' : 'nya prospekt'} väntar`, description: 'Bra läge att ta första kontakt och flytta dem ur ny-läget.', href: '/crm/prospekt' });
  }
  if (args.standaloneCalls > 0) {
    actions.push({ title: `${args.standaloneCalls} fristående samtal ligger ${args.standaloneCalls === 1 ? 'öppet' : 'öppna'}`, description: 'Kontrollera om några av dem ska bli riktiga prospekt.', href: '/crm/samtal' });
  }

  return actions;
}
