import { describe, it, expect } from 'vitest';
import {
  WORK_ORDER_FILE_CATEGORIES,
  WORK_ORDER_FILE_CATEGORY_ORDER,
  toWorkOrderFileCategory,
  workOrderFileCategoryLabel,
  type WorkOrderFileRow,
} from '@/lib/domains/crm/workOrderFiles/types';
import {
  WORK_ORDER_FILE_MAX_BYTES,
  isPreviewableImage,
  validateWorkOrderFile,
} from '@/lib/domains/crm/workOrderFiles/validation';
import {
  buildWorkOrderFilePath,
  isWorkOrderFilePath,
  sanitizeWorkOrderFileName,
} from '@/lib/domains/crm/workOrderFiles/storage';
import { mapWorkOrderFileRow } from '@/lib/domains/crm/workOrderFiles/mappers';

const WORK_ORDER_ID = '55555555-5555-4555-8555-555555555555';
const UPLOADER = 'user-member-1';

describe('validateWorkOrderFile', () => {
  it('släpper igenom en vanlig ritning och ett vanligt foto', () => {
    expect(validateWorkOrderFile({ size: 4_000_000, type: 'application/pdf', name: 'ritning.pdf' })).toBeNull();
    expect(validateWorkOrderFile({ size: 900_000, type: 'image/jpeg', name: 'IMG_0001.jpg' })).toBeNull();
  });

  it('avvisar en tom fil', () => {
    expect(validateWorkOrderFile({ size: 0, type: 'image/jpeg', name: 'x.jpg' })).toBe('Filen är tom.');
  });

  it('avvisar en fil över taket', () => {
    const over = { size: WORK_ORDER_FILE_MAX_BYTES + 1, type: 'application/pdf', name: 'stor.pdf' };
    expect(validateWorkOrderFile(over)).toBe('Filen är för stor (max 25 MB).');
  });

  it('avvisar en filtyp utanför listan', () => {
    // Ett kalkylark på en arbetsorder är inte en ritning, och installatören kan inte öppna det.
    const res = validateWorkOrderFile({ size: 1000, type: 'application/vnd.ms-excel', name: 'kalkyl.xls' });
    expect(res).toContain('Bara bilder');
  });

  // Den här grenen är hela skälet till att en installatör kan ladda upp från iPhone: Safari och
  // en del Android-webbläsare skickar TOM mimetype för HEIC. Faller den bort går fältuppladdning
  // sönder utan att något test blir rött någon annanstans.
  it('faller tillbaka på filändelsen när webbläsaren inte satte någon mimetype', () => {
    expect(validateWorkOrderFile({ size: 3_000_000, type: '', name: 'IMG_4821.HEIC' })).toBeNull();
    expect(validateWorkOrderFile({ size: 3_000_000, type: '', name: 'ritning.pdf' })).toBeNull();
  });

  it('avvisar tom mimetype med okänd filändelse', () => {
    expect(validateWorkOrderFile({ size: 3_000_000, type: '', name: 'arkiv.zip' })).toContain('Bara bilder');
  });
});

describe('isPreviewableImage', () => {
  it('pekar ut det webbläsaren faktiskt kan rita som miniatyr', () => {
    expect(isPreviewableImage('image/jpeg')).toBe(true);
    expect(isPreviewableImage('image/png')).toBe(true);
    expect(isPreviewableImage('image/webp')).toBe(true);
  });

  // HEIC renderas inte i <img> av Chrome eller Firefox på desktop. Signerar vi en URL för den får
  // kontoret en trasig bildikon i stället för ett filkort.
  it('räknar inte HEIC eller PDF som förhandsvisbart', () => {
    expect(isPreviewableImage('image/heic')).toBe(false);
    expect(isPreviewableImage('application/pdf')).toBe(false);
    expect(isPreviewableImage(null)).toBe(false);
  });
});

describe('sanitizeWorkOrderFileName', () => {
  it('gör om svenska tecken och blanksteg till ren ASCII', () => {
    expect(sanitizeWorkOrderFileName('Ritning över vinden.pdf')).toBe('Ritning-_ver-vinden.pdf');
  });

  it('tar bort sökvägstecken', () => {
    expect(sanitizeWorkOrderFileName('../../etc/passwd')).not.toContain('/');
    expect(sanitizeWorkOrderFileName('a\\b/c.pdf')).toBe('a-b-c.pdf');
  });

  it('kapar långa namn och har en fallback för tomma', () => {
    expect(sanitizeWorkOrderFileName('a'.repeat(300)).length).toBe(120);
    expect(sanitizeWorkOrderFileName('   ')).toBe('fil');
  });
});

describe('buildWorkOrderFilePath', () => {
  it('lägger filen under ordern OCH uppladdaren', () => {
    const path = buildWorkOrderFilePath(WORK_ORDER_ID, UPLOADER, 'ritning.pdf', 'uid-1');
    expect(path).toBe(`Arbetsorder/${WORK_ORDER_ID}/${UPLOADER}/uid-1-ritning.pdf`);
  });
});

// Sökvägen kommer tillbaka från klienten i bekräftelsesteget, och upload-token binder bara just
// den sökvägen — inte vem som får läsa den. Sökvägen går dessutom att läsa ut ur den signerade
// URL:en i listan, så vad som helst som visas kan spelas tillbaka hit. Den här funktionen är det
// som gör bekräftelsestegets uppstädning ofarlig.
describe('isWorkOrderFilePath', () => {
  it('godkänner den egna sökvägen under den egna ordern', () => {
    expect(isWorkOrderFilePath(`Arbetsorder/${WORK_ORDER_ID}/${UPLOADER}/uid-ritning.pdf`, WORK_ORDER_ID, UPLOADER)).toBe(true);
  });

  // Kärnan i regressionen: en läsbehörig användare (konsult) kunde annars ta kontorets filsökväg
  // ur miniatyrens URL, posta tillbaka den, bli nekad av RLS — och få kontorets fil raderad av
  // uppstädningen.
  it('nekar en annan användares sökväg på samma order', () => {
    const office = 'user-sales-1';
    expect(isWorkOrderFilePath(`Arbetsorder/${WORK_ORDER_ID}/${office}/uid-ritning.pdf`, WORK_ORDER_ID, UPLOADER)).toBe(false);
  });

  it('nekar ett annat område i bucketen', () => {
    expect(isWorkOrderFilePath('Support/uid-skarmbild.png', WORK_ORDER_ID, UPLOADER)).toBe(false);
    expect(isWorkOrderFilePath('Documents/root/uid-avtal.pdf', WORK_ORDER_ID, UPLOADER)).toBe(false);
  });

  it('nekar en annan arbetsorders prefix', () => {
    const other = '99999999-9999-4999-8999-999999999999';
    expect(isWorkOrderFilePath(`Arbetsorder/${other}/${UPLOADER}/uid-ritning.pdf`, WORK_ORDER_ID, UPLOADER)).toBe(false);
  });

  it('nekar traversering och egna underkataloger', () => {
    expect(isWorkOrderFilePath(`Arbetsorder/${WORK_ORDER_ID}/${UPLOADER}/../../Support/x.png`, WORK_ORDER_ID, UPLOADER)).toBe(false);
    expect(isWorkOrderFilePath(`Arbetsorder/${WORK_ORDER_ID}/${UPLOADER}/sub/x.png`, WORK_ORDER_ID, UPLOADER)).toBe(false);
    expect(isWorkOrderFilePath('', WORK_ORDER_ID, UPLOADER)).toBe(false);
    expect(isWorkOrderFilePath(`Arbetsorder/${WORK_ORDER_ID}/${UPLOADER}/x.png`, WORK_ORDER_ID, '')).toBe(false);
  });
});

describe('kategorikatalogen', () => {
  // En källa, tre konsumenter: Zod-schemat, UI:t och CHECK:en i databasen. Glider de isär blir
  // felet ett 500 vid insert, inte ett rött test — därför låses listan mot strängliteralen ur
  // supabase/sql/20260815_crm_work_order_files.sql.
  it('matchar CHECK-listan i migrationen', () => {
    expect([...WORK_ORDER_FILE_CATEGORIES]).toEqual([
      'drawing', 'preparation', 'photo_before', 'photo_after', 'other',
    ]);
  });

  it('har en etikett per kategori', () => {
    for (const key of WORK_ORDER_FILE_CATEGORIES) {
      expect(workOrderFileCategoryLabel[key]).toBeTruthy();
    }
    expect(Object.keys(workOrderFileCategoryLabel).sort()).toEqual([...WORK_ORDER_FILE_CATEGORIES].sort());
  });

  it('visar kategorierna i jobbets kronologi, inte i bokstavsordning', () => {
    expect([...WORK_ORDER_FILE_CATEGORY_ORDER]).toEqual([
      'drawing', 'preparation', 'photo_before', 'photo_after', 'other',
    ]);
  });

  it('faller tillbaka på "other" för ett okänt värde', () => {
    expect(toWorkOrderFileCategory('sketch')).toBe('other');
    expect(toWorkOrderFileCategory(null)).toBe('other');
    expect(toWorkOrderFileCategory('drawing')).toBe('drawing');
  });
});

describe('mapWorkOrderFileRow', () => {
  const row: WorkOrderFileRow = {
    id: 'file-1',
    work_order_id: WORK_ORDER_ID,
    category: 'drawing',
    is_internal: false,
    file_name: 'ritning.pdf',
    storage_bucket: 'pdfs',
    storage_path: `Arbetsorder/${WORK_ORDER_ID}/${UPLOADER}/uid-ritning.pdf`,
    content_type: 'application/pdf',
    size_bytes: 4000,
    created_by: 'user-sales-1',
    created_by_name: 'Anna Andersson',
    created_at: '2026-08-15T08:00:00.000Z',
  };

  it('tar inte med storage_path eller storage_bucket som fält', () => {
    const view = mapWorkOrderFileRow(row, null);
    expect(view).not.toHaveProperty('storage_path');
    expect(view).not.toHaveProperty('storage_bucket');
  });

  // ⚠️ Det här testet finns för att INTE lura nästa läsare. Ett tidigare påstående här var att
  // sökvägen aldrig når klienten — det var fel: en signerad URL har formen
  // /object/sign/<bucket>/<path>?token=…, så varje rad med miniatyr bär sin sökväg i URL:en.
  // Skyddet ligger på skrivsidan (uppladdarens id i sökvägen + 409 på redan registrerad sökväg),
  // inte på att sökvägen skulle vara okänd. Bygg aldrig något som antar det motsatta.
  it('bär sökvägen i den signerade URL:en — sökvägen är inte hemlig', () => {
    const signed = `https://x.supabase.co/storage/v1/object/sign/pdfs/${row.storage_path}?token=abc`;
    const view = mapWorkOrderFileRow(row, signed);
    expect(view.url).toContain(row.storage_path);
  });

  it('behåller det fliken faktiskt visar', () => {
    const view = mapWorkOrderFileRow(row, 'https://signed.example/x');
    expect(view.file_name).toBe('ritning.pdf');
    expect(view.created_by_name).toBe('Anna Andersson');
    expect(view.category).toBe('drawing');
    expect(view.url).toBe('https://signed.example/x');
  });
});
