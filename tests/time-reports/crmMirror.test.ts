import { describe, it, expect } from 'vitest';
import {
  buildCrmTimeMirrorBody,
  buildCrmTimeMirrorDescription,
  resolveCrmMirrorConfig,
  type CrmTimeMirrorInput,
} from '@/lib/domains/time-reports/crmMirror';

const input = (over: Partial<CrmTimeMirrorInput> = {}): CrmTimeMirrorInput => ({
  blikkUserId: 77,
  internalProjectId: 9001,
  workDate: '2026-08-11',
  hours: 7.5,
  note: 'Blåste vinden klart',
  orderNumber: 'AO-20260810-A1B2',
  fortnoxOrderNumber: '5418',
  projectName: 'Vindsisolering',
  clientName: 'Villa Ek',
  timeArticleId: 3400,
  ...over,
});

describe('buildCrmTimeMirrorBody', () => {
  it('maps a CRM entry onto the Blikk internal-project field names', () => {
    // These key names are the Blikk API contract — renaming one silently drops payroll hours.
    expect(buildCrmTimeMirrorBody(input())).toEqual({
      userId: 77,
      internalProjectId: 9001,
      date: '2026-08-11',
      minutes: 450,
      description: '#5418 · Vindsisolering · Villa Ek — Blåste vinden klart',
      timeArticleId: 3400,
    });
  });

  it('converts hours to whole minutes by rounding, not truncating', () => {
    expect(buildCrmTimeMirrorBody(input({ hours: 7.5 }))?.minutes).toBe(450);
    expect(buildCrmTimeMirrorBody(input({ hours: 0.25 }))?.minutes).toBe(15);
    // numeric(6,2) can produce thirds of an hour; 20 min must not become 19.
    expect(buildCrmTimeMirrorBody(input({ hours: 0.33 }))?.minutes).toBe(20);
  });

  it('never targets a Blikk project or absence project — only the internal project', () => {
    const body = buildCrmTimeMirrorBody(input())!;
    expect(body).not.toHaveProperty('projectId');
    expect(body).not.toHaveProperty('absenceProjectId');
  });

  it('omits the time article when it is not configured', () => {
    expect(buildCrmTimeMirrorBody(input({ timeArticleId: null }))).not.toHaveProperty('timeArticleId');
    expect(buildCrmTimeMirrorBody(input({ timeArticleId: 0 }))).not.toHaveProperty('timeArticleId');
  });

  describe('returns null (skip the mirror) rather than sending something wrong', () => {
    it('when the person has no Blikk mapping', () => {
      expect(buildCrmTimeMirrorBody(input({ blikkUserId: null }))).toBeNull();
      expect(buildCrmTimeMirrorBody(input({ blikkUserId: 0 }))).toBeNull();
    });
    it('when no target internal project is configured', () => {
      expect(buildCrmTimeMirrorBody(input({ internalProjectId: null }))).toBeNull();
    });
    it('when the hours are missing or non-positive', () => {
      expect(buildCrmTimeMirrorBody(input({ hours: 0 }))).toBeNull();
      expect(buildCrmTimeMirrorBody(input({ hours: -1 }))).toBeNull();
      expect(buildCrmTimeMirrorBody(input({ hours: Number.NaN }))).toBeNull();
    });
    it('when the date is not a plain ISO day', () => {
      expect(buildCrmTimeMirrorBody(input({ workDate: '2026-08-11T08:00:00Z' }))).toBeNull();
      expect(buildCrmTimeMirrorBody(input({ workDate: '11/08/2026' }))).toBeNull();
    });
  });
});

describe('buildCrmTimeMirrorDescription', () => {
  it('leads with the Fortnox number when the order is synced', () => {
    expect(
      buildCrmTimeMirrorDescription({ orderNumber: 'AO-1', fortnoxOrderNumber: '5418', projectName: 'Vind', clientName: 'Bygg AB', note: null }),
    ).toBe('#5418 · Vind · Bygg AB');
  });

  it('falls back to the internal order number when not yet synced', () => {
    expect(
      buildCrmTimeMirrorDescription({ orderNumber: 'AO-1', fortnoxOrderNumber: null, projectName: 'Vind', clientName: 'Bygg AB', note: null }),
    ).toBe('AO-1 · Vind · Bygg AB');
  });

  it('drops empty parts instead of leaving dangling separators', () => {
    expect(
      buildCrmTimeMirrorDescription({ orderNumber: 'AO-1', fortnoxOrderNumber: null, projectName: null, clientName: '   ', note: '  ' }),
    ).toBe('AO-1');
  });

  it('appends the note after an em dash so the reference stays scannable', () => {
    expect(
      buildCrmTimeMirrorDescription({ orderNumber: 'AO-1', fortnoxOrderNumber: null, projectName: 'Vind', clientName: null, note: 'Rest 2 h' }),
    ).toBe('AO-1 · Vind — Rest 2 h');
  });
});

describe('resolveCrmMirrorConfig', () => {
  it('reads the target internal project from the environment', () => {
    expect(resolveCrmMirrorConfig({ BLIKK_CRM_INTERNAL_PROJECT_ID: '9001' })).toEqual({
      internalProjectId: 9001,
      timeArticleId: 3400,
    });
  });

  it('treats a missing or unusable project id as "mirroring off", not an error', () => {
    expect(resolveCrmMirrorConfig({}).internalProjectId).toBeNull();
    expect(resolveCrmMirrorConfig({ BLIKK_CRM_INTERNAL_PROJECT_ID: '' }).internalProjectId).toBeNull();
    expect(resolveCrmMirrorConfig({ BLIKK_CRM_INTERNAL_PROJECT_ID: 'nope' }).internalProjectId).toBeNull();
    expect(resolveCrmMirrorConfig({ BLIKK_CRM_INTERNAL_PROJECT_ID: '0' }).internalProjectId).toBeNull();
  });

  it('honours a tenant time-article override, defaulting to the shared 3400', () => {
    expect(resolveCrmMirrorConfig({ BLIKK_TIME_ARTICLE_ID: '4200' }).timeArticleId).toBe(4200);
    expect(resolveCrmMirrorConfig({}).timeArticleId).toBe(3400);
  });
});
