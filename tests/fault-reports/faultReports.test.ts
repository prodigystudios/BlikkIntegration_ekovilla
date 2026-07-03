import { describe, it, expect } from 'vitest';
import {
  createFaultReportSchema,
  updateFaultReportSchema,
  listFaultReportsQuerySchema,
} from '@/lib/domains/fault-reports/schemas';
import { mapFaultReportRow, mapFaultReportUpdateRow } from '@/lib/domains/fault-reports/mappers';
import {
  FAULT_CATEGORIES,
  FAULT_STATUSES,
  categoryLabel,
  statusLabel,
  type FaultReportRow,
} from '@/lib/domains/fault-reports/types';
import { dedupeRecipients, dedupeEmails } from '@/lib/domains/fault-reports/recipients';
import { buildFaultReportEmail } from '@/lib/domains/fault-reports/email';

describe('createFaultReportSchema', () => {
  it('accepts each of the five categories', () => {
    for (const c of FAULT_CATEGORIES) {
      expect(createFaultReportSchema.parse({ category: c, comment: 'trasig' }).category).toBe(c);
    }
  });

  it('rejects an unknown category', () => {
    expect(() => createFaultReportSchema.parse({ category: 'gaffeltruck', comment: 'x' })).toThrow();
  });

  it('rejects empty / whitespace comment and trims', () => {
    expect(() => createFaultReportSchema.parse({ category: 'truck', comment: '' })).toThrow();
    expect(() => createFaultReportSchema.parse({ category: 'truck', comment: '   ' })).toThrow();
    expect(createFaultReportSchema.parse({ category: 'truck', comment: '  fel  ' }).comment).toBe('fel');
  });
});

describe('updateFaultReportSchema', () => {
  it('requires a valid status and defaults reply to null', () => {
    expect(updateFaultReportSchema.parse({ status: 'in_progress' })).toEqual({ status: 'in_progress', reply: null });
    expect(() => updateFaultReportSchema.parse({ status: 'closed' })).toThrow();
  });

  it('normalises blank reply to null and trims a real reply', () => {
    expect(updateFaultReportSchema.parse({ status: 'resolved', reply: '   ' }).reply).toBeNull();
    expect(updateFaultReportSchema.parse({ status: 'resolved', reply: ' fixat ' }).reply).toBe('fixat');
  });
});

describe('listFaultReportsQuerySchema', () => {
  it('defaults scope to mine', () => {
    expect(listFaultReportsQuerySchema.parse({}).scope).toBe('mine');
  });
  it('rejects an unknown scope', () => {
    expect(() => listFaultReportsQuerySchema.parse({ scope: 'all' })).toThrow();
  });
});

describe('category / status label completeness', () => {
  it('every category has a Swedish label', () => {
    for (const c of FAULT_CATEGORIES) expect(categoryLabel[c]).toBeTruthy();
    expect(categoryLabel.isoleringsmaskin).toBe('Isoleringsmaskin');
  });
  it('every status has a Swedish label', () => {
    for (const s of FAULT_STATUSES) expect(statusLabel[s]).toBeTruthy();
    expect(statusLabel.in_progress).toBe('Pågår');
  });
});

describe('mapFaultReportRow', () => {
  const row: FaultReportRow = {
    id: 'r1',
    reporter_id: 'u1',
    reporter_name: 'Anna',
    category: 'lastbil',
    comment: 'Punktering',
    status: 'in_progress',
    reply: null,
    responder_id: null,
    responder_name: null,
    responded_at: null,
    created_at: '2026-07-03T09:00:00.000Z',
    updated_at: '2026-07-03T09:00:00.000Z',
  };

  it('maps category/status to labels', () => {
    const v = mapFaultReportRow(row);
    expect(v.category).toBe('lastbil');
    expect(v.category_label).toBe('Lastbil');
    expect(v.status).toBe('in_progress');
    expect(v.status_label).toBe('Pågår');
  });

  it('falls back to a safe status for an unknown DB value', () => {
    expect(mapFaultReportRow({ ...row, status: 'weird' }).status).toBe('new');
  });
});

describe('mapFaultReportUpdateRow', () => {
  it('maps a history entry status to its label and keeps reply/responder', () => {
    const v = mapFaultReportUpdateRow({
      id: 'h1',
      report_id: 'r1',
      status: 'resolved',
      reply: 'Bytte filter',
      responder_id: 'u2',
      responder_name: 'Kalle',
      created_at: '2026-07-03T12:00:00.000Z',
    });
    expect(v.status).toBe('resolved');
    expect(v.status_label).toBe('Åtgärdad');
    expect(v.reply).toBe('Bytte filter');
    expect(v.responder_name).toBe('Kalle');
  });
});

describe('dedupeRecipients / dedupeEmails', () => {
  it('dedupes user ids and drops blanks', () => {
    expect(dedupeRecipients(['a', 'a', ' b ', '', null, undefined])).toEqual(['a', 'b']);
  });
  it('dedupes emails case-insensitively but keeps first casing', () => {
    expect(dedupeEmails(['A@x.se', 'a@x.se', ' b@x.se ', ''])).toEqual(['A@x.se', 'b@x.se']);
  });
});

describe('buildFaultReportEmail', () => {
  const report = mapFaultReportRow({
    id: 'r9',
    reporter_id: 'u1',
    reporter_name: 'Bertil',
    category: 'isoleringsmaskin',
    comment: 'Läcker olja',
    status: 'new',
    reply: null,
    responder_id: null,
    responder_name: null,
    responded_at: null,
    created_at: '2026-07-03T09:00:00.000Z',
    updated_at: '2026-07-03T09:00:00.000Z',
  });

  it('includes category, reporter and a deep link when a base url is given', () => {
    const { subject, html, text } = buildFaultReportEmail(report, 'https://app.example.se/');
    expect(subject).toContain('Isoleringsmaskin');
    expect(text).toContain('Bertil');
    expect(text).toContain('Läcker olja');
    expect(html).toContain('https://app.example.se/felanmalan?arende=r9&scope=inbox');
  });

  it('escapes HTML in user content', () => {
    const evil = mapFaultReportRow({
      id: 'r9', reporter_id: 'u1', reporter_name: '<b>x</b>', category: 'truck', comment: '<script>',
      status: 'new', reply: null, responder_id: null, responder_name: null, responded_at: null,
      created_at: '2026-07-03T09:00:00.000Z', updated_at: '2026-07-03T09:00:00.000Z',
    });
    const { html } = buildFaultReportEmail(evil);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
