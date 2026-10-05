import { daysSince } from '@/lib/shared/relativeTime';

export type OverviewAction = { title: string; description: string; href: string };

// Hur många rader Att agera på visar. Kortet är medvetet tight: allt under det ska synas utan att
// man scrollar förbi en lång lista.
export const ACTION_LIMIT = 3;

/** Samtalsloggen har legat stilla: hur många dygn, när det går att säga. */
export type StaleCalls = { days: number | null };

/**
 * Har samtalsloggen legat stilla i sju dagar? Samtalsloggen SKA användas — att den ligger stilla
 * är säljarnas slarv, inte en död funktion. Flyttad hit ur kortet Senaste samtal när det togs bort.
 *
 * 🧨 UTLÖSAREN får inte komma ur listan. Den är kapad till fem rader, och crm_calls_select_visible
 * släpper igenom mer än de egna samtalen — även kollegors samtal på prospekt man är tilldelad. Fem
 * sådana räckte för att den egna raden föll utanför urvalet, och då tystnade påminnelsen precis när
 * den skulle ha ljudit.
 *
 * callsLast7Days räknas av servern på HELA det synliga urvalet. Är den noll har ingen som läsaren
 * ser loggat något på sju dagar — och för en säljare ingår hen själv i det, så båda formuleringarna
 * i staleCallsAction är sanna oavsett vem som läser.
 *
 * Antalet dygn är däremot bara en detalj och får komma ur listan när det går. Ligger den egna raden
 * utanför de fem blir det null, och raden säger "över en vecka" i stället för att gissa en siffra.
 */
export function staleCalls(args: {
  callsLast7Days: number;
  calls: Array<{ user_id: string; call_at: string }>;
  /** Läsaren ser hela lagets samtal (crm.admin) — samma nyckel som styr vad API:t lämnar ut. */
  seesWholeTeam: boolean;
  userId: string | null;
  now?: number;
}): StaleCalls | null {
  if (args.callsLast7Days > 0 || args.calls.length === 0) return null;
  const scoped = args.seesWholeTeam ? args.calls : args.calls.filter((call) => call.user_id === args.userId);
  return { days: daysSince(scoped[0]?.call_at, args.now) };
}

// Urvalet är RLS-filtrerat: en admin ser allas samtal, alla andra sina egna plus kollegors på
// prospekt de äger. Påståendet måste följa med — "ingen har loggat" vore fel när det bara betyder
// att DU inte har det.
function staleCallsAction(stale: StaleCalls, seesWholeTeam: boolean): OverviewAction {
  const since = stale.days != null ? `${stale.days} dagar` : 'över en vecka';
  return {
    title: seesWholeTeam ? `Ingen har loggat ett samtal på ${since}` : `Du har inte loggat ett samtal på ${since}`,
    description: 'Logga samtalen när de görs — veckans tavla räknar bara det som står i loggen.',
    href: '/crm/samtal?log=1',
  };
}

// Rubrikerna räknas upp i singular vid 1. Neutrum-substantiv (samtal, prospekt) har samma
// form i båda numerus, men adjektiven och t-orden runt dem har det inte — "1 fristående
// samtal ligger öppna" — så hela frasen står i varje gren. Samtalsraden behöver ingen gren:
// "samtal" böjs inte och svenska presensverb böjs inte efter numerus.
//
// Ordningen är prioriteten, och kortet visar de ACTION_LIMIT första. Den stillastående loggen står
// direkt efter de sena uppgifterna: den kan inte tränga undan samtalsraderna, för när den syns är
// veckans samtal noll och de två samtalsraderna tomma.
export function buildOverviewActions(args: {
  overdueTasks: number;
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

  return actions.slice(0, ACTION_LIMIT);
}
