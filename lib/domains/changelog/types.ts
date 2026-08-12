// Changelog — domäntyper.
//
// Listan har TVÅ källor: fritt skrivna poster (app_changelog_entries) och publicerade appärenden
// (app_tickets med changelog_published_at satt). Vyn nedan är den gemensamma formen båda mappas
// till, så resten av appen aldrig behöver veta varifrån en rad kom. Sammanslagningen sker i
// merge.ts.

export const CHANGELOG_CATEGORIES = ['fixed', 'new', 'improved'] as const;
export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number];

export const categoryLabel: Record<ChangelogCategory, string> = {
  fixed: 'Fixat',
  new: 'Nytt',
  improved: 'Förbättrat',
};

export function toChangelogCategory(value: unknown): ChangelogCategory {
  return CHANGELOG_CATEGORIES.includes(value as ChangelogCategory) ? (value as ChangelogCategory) : 'improved';
}

// Ett publicerat ärendes `kind` avgör kategorin. En bugg som stängts ÄR något som fixats, ett
// önskemål som byggts ÄR något nytt — så läsaren slipper veta att raden kom från ett ärende.
export function categoryFromTicketKind(kind: string): ChangelogCategory {
  return kind === 'bug' ? 'fixed' : 'new';
}

export type ChangelogEntryRow = {
  id: string;
  category: string;
  title: string;
  body: string | null;
  published_at: string | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
};

// Delmängden av app_tickets som changeloggen läser. Skilt från AppTicketRow: den här vyn ska inte
// råka få tillgång till beskrivning, skärmbild eller interna svar.
export type ChangelogTicketRow = {
  id: string;
  kind: string;
  changelog_note: string | null;
  changelog_published_at: string | null;
  reporter_name: string;
};

export type ChangelogSource = 'entry' | 'ticket';

export type ChangelogItemView = {
  id: string;
  source: ChangelogSource;
  category: ChangelogCategory;
  category_label: string;
  title: string;
  body: string | null;
  published_at: string;
  // Bara satt för ärendevägen: vem som rapporterade det som nu är fixat. Det är den detaljen som
  // sluter loopen mot ticketsystemet — den som skrev in något ser att det kom med.
  reported_by: string | null;
};

// Ett utkast (published_at = null) syns bara i adminvyn. Skilt från ChangelogItemView eftersom den
// senare garanterar en publiceringstidpunkt — och listan sorteras på den.
export type ChangelogDraftView = {
  id: string;
  category: ChangelogCategory;
  category_label: string;
  title: string;
  body: string | null;
  published_at: string | null;
  created_by_name: string;
  created_at: string;
};
