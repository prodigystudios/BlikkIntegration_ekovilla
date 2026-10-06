import { z } from 'zod';

// Översiktens datum från klienten (ÅÅÅÅ-MM-DD). Formen räcker inte: datumen går in i databasfilter,
// och 2026-02-30 har rätt form men får Postgres att vägra — ett 500 där sidan skulle fått sina siffror.
// Date.parse först: månad 13 ger NaN, och toISOString på ett ogiltigt datum KASTAR.
export const overviewDaySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ogiltigt datum (ÅÅÅÅ-MM-DD)')
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }, 'Datumet finns inte');
