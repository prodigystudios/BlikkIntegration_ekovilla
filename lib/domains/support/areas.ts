import type { TicketArea } from './types';

// Gissar vilken del av appen ett ärende gäller utifrån sidan användaren står på.
//
// Ren funktion i ett eget modul (inte i "use client"-komponenten) så den kan enhetstestas utan att
// dra in next/navigation och hela modalen. Gissningen är det som gör formuläret snabbt att fylla i
// — en felgissning ger en osorterad backlog, så ordningen nedan spelar roll: mer specifika prefix
// måste testas före de bredare.
export function guessAreaFromPath(pathname: string): TicketArea {
  const path = pathname || '/';

  // /crm/* har egna underytor som hör hemma i andra areor — de måste fångas före den breda
  // /crm-grenen längre ner.
  if (path.startsWith('/crm/planering') || path.startsWith('/plannering')) return 'planning';
  if (path.startsWith('/crm/korjournal')) return 'korjournal';
  if (path.startsWith('/crm/dokument') || path.startsWith('/mina-dokument') || path.startsWith('/dokument')) {
    return 'documents';
  }
  if (path.startsWith('/crm')) return 'crm';

  // Offertkalkylatorn är säljarnas verktyg och hör till samma värld som offerterna.
  if (path.startsWith('/offert')) return 'crm';

  if (path.startsWith('/mina-jobb') || path.startsWith('/arbetsorder')) return 'field';
  if (path.startsWith('/egenkontroll') || path.startsWith('/archive')) return 'self_check';

  // Både den nya /tid och den Blikk-kopplade /tidrapport är "Tidrapport" för den som använder dem.
  if (path.startsWith('/tid')) return 'time';

  if (path.startsWith('/auth')) return 'account';

  return 'other';
}
