import { describe, it, expect } from 'vitest';
import { checkPortalCronAuth } from '@/lib/domains/portal/cronAuth';

// Portalens cron-route (fas 4b): Vercel skickar Authorization: Bearer <CRON_SECRET>.

const SECRET = 'cron-hemlighet-0123456789';

describe('checkPortalCronAuth', () => {
  it('rätt nyckel släpps igenom, också med annan skiftläge på "Bearer" och blanktecken runt', () => {
    expect(checkPortalCronAuth(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true });
    expect(checkPortalCronAuth(`  bearer ${SECRET}  `, ` ${SECRET} `)).toEqual({ ok: true });
  });

  it('fel, saknad eller annan form: 401', () => {
    for (const header of [`Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, SECRET, `Basic ${SECRET}`, 'Bearer ', '', null]) {
      expect(checkPortalCronAuth(header, SECRET)).toEqual({ ok: false, status: 401 });
    }
  });

  it('utan CRON_SECRET är routen avstängd (503), aldrig öppen — inte heller för en tom nyckel', () => {
    for (const secret of [undefined, '', '   ']) {
      expect(checkPortalCronAuth('Bearer ', secret)).toEqual({ ok: false, status: 503 });
      expect(checkPortalCronAuth('Bearer x', secret)).toEqual({ ok: false, status: 503 });
    }
  });
});
