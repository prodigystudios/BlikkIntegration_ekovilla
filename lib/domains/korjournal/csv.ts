// CSV export for a month's trips. Semicolon-delimited (Swedish-locale Excel),
// quoted/escaped fields, UTF-8 BOM prefix so Excel detects å/ä/ö on Windows.

import type { Trip } from './types';
import { diffKm, isComplete, monthKm } from './calculations';

const HEADER = ['Datum', 'Startadress', 'Slutadress', 'Start km', 'Slut km', 'Distans', 'Anteckning'];

// UTF-8 BOM (U+FEFF), built from its code point to avoid an invisible literal in source.
const BOM = String.fromCharCode(0xfeff);

function esc(val: unknown): string {
  if (val === null || val === undefined) return '';
  let s = String(val);
  // Normalize CRLF -> LF for consistency.
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const needsQuote = /[;"\n]|(^\s)|($\s)/.test(s);
  if (s.includes('"')) s = s.replace(/"/g, '""');
  return needsQuote ? `"${s}"` : s;
}

// Trips with missing/invalid km that must be completed before export.
export function incompleteTripsForExport(trips: Trip[]): Trip[] {
  return trips.filter((t) => !isComplete(t));
}

// Serialize a month's trips to CSV text (BOM-prefixed).
export function serializeTripsCsv(ym: string, trips: Trip[]): string {
  const dataLines = trips.map((t) =>
    [t.date, t.startAddress, t.endAddress, t.startKm ?? '', t.endKm ?? '', diffKm(t), t.note || '']
      .map(esc)
      .join(';'),
  );
  const lines = [
    esc(`Körjournal ${ym}`),
    HEADER.map(esc).join(';'),
    ...dataLines,
    ['Total km', monthKm(trips)].map(esc).join(';'),
  ];
  return BOM + lines.join('\n');
}

export function csvFileName(ym: string) {
  return `korjournal_${ym}.csv`;
}
