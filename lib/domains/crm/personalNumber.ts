// Svenskt personnummer — format och validering.
//
// VARFÖR TOLV SIFFROR, INTE TIO. Fortnox tar emot personnumret i samma fält som ett företags
// org.nr (OrganisationNumber), och accepterar tio siffror utan att klaga. Men ROT- och
// husarbetesuppgifterna slutar då fungera på dokumentet, och avdraget måste läggas in för hand i
// Fortnox efteråt. Felet syns alltså inte där det begås — det dyker upp långt senare, i
// bokföringen. Därför låser vi formatet i stället för att varna.
//
// EGEN MODUL I lib/, inte i app/crm/kunder/customerNumbers.ts: reglerna måste gälla i BÅDA
// riktningarna. Klienten maskar medan man skriver, routen validerar det som faktiskt sparas, och
// orderflödet vägrar skapa en order på ett ofullständigt nummer. Tre ställen, en sanning.
//
// Org.nr rör vi inte — det ÄR tio siffror. formatSwedishIdNumber lever kvar för det.

/** Alla icke-siffror bort. Personnummer skrivs med bindestreck, plus, mellanslag — allt duger. */
export function personalNumberDigits(value: string): string {
  return (value || '').replace(/\D/g, '');
}

// Luhn (mod 10) över de tio sista siffrorna (ÅÅMMDDXXXX). Kontrollsiffran räknas ALLTID på
// tiosiffersformen — århundradet ingår inte i beräkningen, vilket är just därför ett felaktigt
// århundrade passerar Luhn och måste fångas av datumkontrollen nedan.
function luhn10Valid(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = digits.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Maskar medan man skriver: ÅÅÅÅMMDD-XXXX. Tolv siffror, bindestreck efter det åttonde.
 *
 * Skilt från formatSwedishIdNumber (org.nr), som kapar vid tio och sätter bindestrecket efter det
 * sjätte. Att återanvända den för personnummer var precis felet — den klippte bort århundradet.
 */
export function formatPersonalNumber(value: string): string {
  const digits = personalNumberDigits(value).slice(0, 12);
  if (digits.length <= 8) return digits;
  return `${digits.slice(0, 8)}-${digits.slice(8)}`;
}

/**
 * Födelsedatumet ur ett tolvsiffrigt nummer, eller null om det inte är ett verkligt datum.
 *
 * Samordningsnummer (för den som saknar personnummer men ska folkbokföras för t.ex. arbete eller
 * fastighetsägande) har dag + 60. De är giltiga kundnummer och får inte nekas.
 */
export function parsePersonalNumberBirthDate(digits: string): Date | null {
  if (!/^\d{12}$/.test(digits)) return null;

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const rawDay = Number(digits.slice(6, 8));
  const day = rawDay > 60 ? rawDay - 60 : rawDay;

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  // Fångar 31 februari och liknande: Date rullar över till nästa månad.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return date;
}

/**
 * Är numret ett komplett, rimligt personnummer med fullt årtal?
 *
 * Tre villkor, och det tredje är det som gör verklig nytta: eftersom Luhn bara räknar på de tio
 * sista siffrorna passerar ett FELAKTIGT århundrade kontrollsiffran utan problem. Skriver någon
 * `20850101-...` för en person född 1985 blir födelsedatumet 2085 — i framtiden. Utan
 * datumkontrollen hade det sett giltigt ut hela vägen fram till Fortnox.
 */
export function isValidPersonalNumber(value: string, now: Date = new Date()): boolean {
  const digits = personalNumberDigits(value);
  if (digits.length !== 12) return false;
  if (!luhn10Valid(digits.slice(2))) return false;

  const birth = parsePersonalNumberBirthDate(digits);
  if (!birth) return false;
  if (birth.getTime() > now.getTime()) return false;

  // Ingen levande kund är över 120 år. Fångar ett århundrade som slunkit ner i stället för upp.
  const oldest = new Date(now.getFullYear() - 120, now.getMonth(), now.getDate());
  if (birth.getTime() < oldest.getTime()) return false;

  return true;
}

/**
 * Kanonisk lagringsform: ÅÅÅÅMMDD-XXXX. Returnerar null när numret inte håller — anroparen ska
 * då neka, inte gissa. Att härleda århundradet ur ett tiosiffrigt nummer vore en gissning, och en
 * gissning på fel sida av sekelskiftet ger exakt samma trasiga ROT-uppgifter som idag.
 */
export function normalizePersonalNumber(value: string, now: Date = new Date()): string | null {
  if (!isValidPersonalNumber(value, now)) return null;
  const digits = personalNumberDigits(value);
  return `${digits.slice(0, 8)}-${digits.slice(8)}`;
}

/** Felmeddelandet, på ett ställe — samma ord i formuläret, i routen och i orderflödet. */
export const PERSONAL_NUMBER_ERROR =
  'Ange personnumret med fullt årtal: ÅÅÅÅMMDD-XXXX (12 siffror). Tio siffror gör att ROT- och husarbetesuppgifterna slutar fungera i Fortnox.';

/** Kortare variant för trånga ytor (inline-hjälp under fältet). */
export const PERSONAL_NUMBER_HINT = 'Fullt årtal krävs — ÅÅÅÅMMDD-XXXX. Annars fungerar inte ROT i Fortnox.';

/**
 * Hjälptexten under ett TOMT fält. Numret är valfritt på kunden — säljaren får det ofta först när
 * jobbet bokas — och kravet sitter i stället på arbetsordern. Här och inte i formulären, eftersom
 * skapa-vyn och detaljvyn inte delar sparlogik: en spärr som bara rättades i den ena är precis det
 * som gjorde att befintliga kunder inte gick att spara om.
 */
export const PERSONAL_NUMBER_OPTIONAL_HINT =
  `Kan fyllas i senare, men krävs innan en order kan skapas. ${PERSONAL_NUMBER_HINT}`;
