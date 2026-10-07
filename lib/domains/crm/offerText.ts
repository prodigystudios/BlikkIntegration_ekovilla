// Egen text på offerten: fritext som säljaren skriver i offertformuläret och som skrivs ut på
// offertens PDF under artikelraderna (documentPdfDesign.ts → `freeText`).
//
// Texten ligger i CRM (`crm_quotes.offer_text`) och skickas INTE till Fortnox. `Remarks` bär
// företagets standard-offerttext och skulle skrivas över, och en textrad i radlistan följer med
// createorder till ordern och fakturan. Texten gäller bara offerten (William 2026-10-07).

/**
 * Taket för texten. Formulärets fält och rutternas schema delar samma värde, så säljaren aldrig får
 * ett serverfel för en text som fältet tog emot. 2000 tecken räcker till en sida med villkor och
 * förutsättningar. Längre text bryts ändå över sidor på PDF:en.
 */
export const OFFER_TEXT_MAX_LENGTH = 2000;
