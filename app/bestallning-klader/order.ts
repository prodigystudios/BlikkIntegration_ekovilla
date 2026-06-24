// Pure model + summary builder for the clothing order form. Extracted so the
// summary that lands in the created task is unit-testable.

export type SizeRow = { size: string; selected: boolean };
export type SectionState = { key: string; title: string; rows: SizeRow[]; qty: number };

// Human-readable order summary: one line per garment with a picked size, with a
// "xN" suffix when qty > 1. Returns '' when nothing is selected.
export function buildOrderSummary(sections: SectionState[]): string {
  const lines: string[] = [];
  for (const sec of sections) {
    const picked = sec.rows.find((r) => r.selected);
    if (!picked) continue;
    const part = sec.qty > 1 ? `${picked.size} x${sec.qty}` : picked.size;
    lines.push(`- ${sec.title}: ${part}`);
  }
  if (!lines.length) return '';
  return `Beställning:\n${lines.join('\n')}`;
}
