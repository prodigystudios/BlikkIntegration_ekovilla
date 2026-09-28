import { describe, it, expect } from 'vitest';
import {
  PORTAL_SIGNATURE_HEADER,
  PORTAL_TIMESTAMP_HEADER,
  signPortalRequest,
  verifyPortalSignature,
} from '@/lib/domains/portal/signature';
import { CONTRACT_JOB, SIGNATURE_VECTOR } from './helpers/contractFixtures';

const { secret, timestamp, method, path, body, signature } = SIGNATURE_VECTOR;
const now = Number(timestamp);

function sign(overrides: Partial<Parameters<typeof signPortalRequest>[0]> = {}) {
  return signPortalRequest({ secret, method, path, rawBody: body, nowSeconds: now, ...overrides });
}

function verify(overrides: Partial<Parameters<typeof verifyPortalSignature>[0]> = {}) {
  return verifyPortalSignature({
    secret,
    method,
    path,
    rawBody: body,
    timestampHeader: timestamp,
    signatureHeader: signature,
    nowSeconds: now,
    ...overrides,
  });
}

describe('signPortalRequest', () => {
  it('ger exakt kontraktets signatur, räknad oberoende av CRM:ets kod', () => {
    expect(sign()).toEqual({ [PORTAL_TIMESTAMP_HEADER]: timestamp, [PORTAL_SIGNATURE_HEADER]: signature });
  });

  it('använder header-namnen i kontraktet', () => {
    expect(PORTAL_TIMESTAMP_HEADER).toBe('X-Ekovilla-Timestamp');
    expect(PORTAL_SIGNATURE_HEADER).toBe('X-Ekovilla-Signature');
  });

  it('signerar byte som en UTF-8-sträng — samma signatur för strängen och dess byte', () => {
    expect(sign({ rawBody: new TextEncoder().encode(body) })[PORTAL_SIGNATURE_HEADER]).toBe(signature);
  });

  it('skriver metoden med versaler', () => {
    expect(sign({ method: 'post' })[PORTAL_SIGNATURE_HEADER]).toBe(signature);
  });

  it('avrundar klockan nedåt till hela sekunder', () => {
    expect(sign({ nowSeconds: now + 0.9 })[PORTAL_TIMESTAMP_HEADER]).toBe(timestamp);
  });

  it('vägrar signera med en tom eller kort hemlighet — en sådan signatur går att gissa', () => {
    expect(() => sign({ secret: '' })).toThrow();
    expect(() => sign({ secret: 'för-kort' })).toThrow();
  });

  it('vägrar signera när klockan inte är ett tal', () => {
    expect(() => sign({ nowSeconds: Number.NaN })).toThrow();
  });

  it('trimmar hemligheten: en avslutande radbrytning ger samma signatur', () => {
    expect(sign({ secret: `${secret}\n` })[PORTAL_SIGNATURE_HEADER]).toBe(signature);
  });

  it('vägrar en sökväg eller metod som kunde göra strängen tvetydig', () => {
    // Radbrytningen är avgränsaren; frågesträngen hör inte till sökvägen; sökvägen börjar i roten.
    for (const bad of ['/api/portal/jobs\nPOST', '/api/portal/jobs?x=1', '/api/portal/jobs#a', 'api/portal/jobs', '/api/portal/jobs 2']) {
      expect(() => sign({ path: bad })).toThrow();
    }
    for (const bad of ['', 'PO ST', 'POST\n', 'P0ST']) {
      expect(() => sign({ method: bad })).toThrow();
    }
  });
});

describe('verifyPortalSignature', () => {
  it('godtar kontraktets signatur', () => {
    expect(verify()).toEqual({ ok: true });
  });

  it('godtar ett helt jobb som signerats och skickats oförändrat', () => {
    const raw = JSON.stringify(CONTRACT_JOB);
    const headers = sign({ path: '/api/portal/jobs', rawBody: raw });
    expect(
      verify({
        path: '/api/portal/jobs',
        rawBody: raw,
        timestampHeader: headers[PORTAL_TIMESTAMP_HEADER],
        signatureHeader: headers[PORTAL_SIGNATURE_HEADER],
      }),
    ).toEqual({ ok: true });
  });

  it('nekar samma innehåll serialiserat om — signaturen gäller den råa kroppen', () => {
    const raw = JSON.stringify(CONTRACT_JOB);
    const headers = sign({ path: '/api/portal/jobs', rawBody: raw });
    expect(
      verify({
        path: '/api/portal/jobs',
        rawBody: JSON.stringify(JSON.parse(raw), null, 2),
        timestampHeader: headers[PORTAL_TIMESTAMP_HEADER],
        signatureHeader: headers[PORTAL_SIGNATURE_HEADER],
      }),
    ).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('🧨 en signerad ping duger inte till att dra tillbaka en beställning — sökvägen ingår', () => {
    const ping = sign({ path: '/api/portal/ping', rawBody: '' });
    expect(
      verify({
        path: '/api/portal/store-orders/so-b-2026-003/withdraw',
        rawBody: '',
        timestampHeader: ping[PORTAL_TIMESTAMP_HEADER],
        signatureHeader: ping[PORTAL_SIGNATURE_HEADER],
      }),
    ).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('🧨 metoden ingår: en signerad POST duger inte som PUT', () => {
    expect(verify({ method: 'PUT' })).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('🧨 riktningen ingår genom sökvägen: portalens route och CRM:ets route har olika signaturer', () => {
    expect(verify({ path: '/api/ekovilla/jobs/q-2026-015/messages' })).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('nekar en ändrad kropp, fel hemlighet och en annan tidsstämpel', () => {
    expect(verify({ rawBody: body.replace('ute', 'inne') })).toEqual({ ok: false, reason: 'signature_mismatch' });
    expect(verify({ secret: `${secret}x` })).toEqual({ ok: false, reason: 'signature_mismatch' });
    // Tidsstämpeln ingår i det som signeras: en ny stämpel på en gammal signatur duger inte.
    expect(verify({ timestampHeader: String(now + 1), nowSeconds: now + 1 })).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('godtar 300 sekunders avvikelse åt båda hållen, men inte 301', () => {
    expect(verify({ nowSeconds: now + 300 })).toEqual({ ok: true });
    expect(verify({ nowSeconds: now - 300 })).toEqual({ ok: true });
    expect(verify({ nowSeconds: now + 301 })).toEqual({ ok: false, reason: 'stale_timestamp' });
    expect(verify({ nowSeconds: now - 301 })).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('🧨 faller stängt när klockan inte är ett tal — NaN får inte släppa igenom en gammal signatur', () => {
    expect(verify({ nowSeconds: Number.NaN })).toEqual({ ok: false, reason: 'stale_timestamp' });
    expect(verify({ nowSeconds: Number.POSITIVE_INFINITY })).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('nekar en tidsstämpel som inte är hela unix-sekunder', () => {
    for (const bad of ['1790000000.5', '-1790000000', 'abc', '2026-09-27T12:00:00Z', '1e9']) {
      expect(verify({ timestampHeader: bad })).toEqual({ ok: false, reason: 'bad_timestamp' });
    }
  });

  it('nekar när en header saknas', () => {
    expect(verify({ timestampHeader: null })).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verify({ signatureHeader: undefined })).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verify({ signatureHeader: '   ' })).toEqual({ ok: false, reason: 'missing_headers' });
  });

  it('nekar en signatur utan v1= eller med fel form', () => {
    const hex = signature.slice(3);
    expect(verify({ signatureHeader: hex })).toEqual({ ok: false, reason: 'bad_signature_format' });
    expect(verify({ signatureHeader: `v2=${hex}` })).toEqual({ ok: false, reason: 'bad_signature_format' });
    expect(verify({ signatureHeader: `v1=${hex.slice(0, 63)}` })).toEqual({ ok: false, reason: 'bad_signature_format' });
    // Buffer.from(x, 'hex') hade tyst slutat vid 'g' — formen prövas därför först.
    expect(verify({ signatureHeader: `v1=${hex.slice(0, 63)}g` })).toEqual({ ok: false, reason: 'bad_signature_format' });
  });

  it('godtar versaler i hex och mellanslag runt headervärdena', () => {
    expect(verify({ signatureHeader: `v1=${signature.slice(3).toUpperCase()}` })).toEqual({ ok: true });
    expect(verify({ signatureHeader: ` ${signature} `, timestampHeader: ` ${timestamp}` })).toEqual({ ok: true });
  });

  it('trimmar hemligheten som den prövas: en radbrytning från Vercel ger inte 401 på allt', () => {
    expect(verify({ secret: `${secret}\n` })).toEqual({ ok: true });
    expect(verify({ secret: `  ${secret}  ` })).toEqual({ ok: true });
  });

  it('säger att hemligheten saknas i stället för att pröva mot en tom — det blir 503, inte 401', () => {
    expect(verify({ secret: '' })).toEqual({ ok: false, reason: 'secret_not_configured' });
    expect(verify({ secret: null })).toEqual({ ok: false, reason: 'secret_not_configured' });
    expect(verify({ secret: 'för-kort' })).toEqual({ ok: false, reason: 'secret_not_configured' });
  });
});
