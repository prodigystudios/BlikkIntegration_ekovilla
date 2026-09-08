import type { OpsSegment } from '@/lib/domains/planning/types';

// Formulärvärdena för en platshållare, och regeln för vad en sparning faktiskt skickar.
//
// Egen modul och inte en del av PlaceholderModal.tsx: reglerna här är rena och bär ett skydd som
// måste gå att pröva i test, och en 'use client'-komponent går inte att importera från vitest.

export type PlaceholderInput = {
  title: string;
  customer: string | null;
  truck_id: string;
  start_day: string;
  end_day: string;
  job_type: string | null;
  field_visible: boolean;
  work_description: string | null;
};

/**
 * Vid redigering skickas BARA det som ändrats, inte hela formuläret.
 *
 * 🧨 Annars skriver varje sparning tillbaka de värden fältet hade när modalen öppnades, och två
 * planerare på samma platshållare skriver över varandra tyst: A öppnar för att rätta ett stavfel,
 * B publicerar den för entreprenaden, A sparar — och `field_visible: false` följer med från A:s
 * gamla ögonblicksbild. Bokningen försvinner ur besättningens feed och loggen säger att A dolde
 * den. Tavlan laddas om i realtid av just det skälet; formuläret får inte vara det som backar.
 *
 * Tomma rutor jämförs mot `null`, inte mot tom sträng: formuläret håller `''` i en tom ruta men
 * skickar `null`, så utan normaliseringen hade varje sparning sett en orörd tom ruta som en
 * ändring. Rutten tar emot partiella patchar, så det räcker att utelämna fälten.
 */
export function placeholderChanges(next: PlaceholderInput, prev: OpsSegment): Partial<PlaceholderInput> {
  const patch: Partial<PlaceholderInput> = {};
  if (next.title !== (prev.placeholder_title ?? '')) patch.title = next.title;
  if (next.customer !== (prev.placeholder_customer ?? null)) patch.customer = next.customer;
  if (next.truck_id !== prev.truck_id) patch.truck_id = next.truck_id;
  if (next.start_day !== prev.start_day) patch.start_day = next.start_day;
  if (next.end_day !== prev.end_day) patch.end_day = next.end_day;
  if (next.job_type !== (prev.job_type ?? null)) patch.job_type = next.job_type;
  if (next.field_visible !== prev.field_visible) patch.field_visible = next.field_visible;
  if (next.work_description !== (prev.work_description ?? null)) patch.work_description = next.work_description;
  return patch;
}
