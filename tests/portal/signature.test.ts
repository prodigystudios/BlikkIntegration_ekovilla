import { describe, it, expect } from 'vitest';
import {
  PORTAL_SIGNATURE_HEADER,
  PORTAL_TIMESTAMP_HEADER,
  signPortalRequest,
  verifyPortalSignature,
} from '@/lib/domains/portal/signature';
import { CONTRACT_JOB, SIGNATURE_VECTOR } from './fixtures/contract';

const { secret, timestamp, body, signature } = SIGNATURE_VECTOR;
const now = Number(timestamp);

function verify(overrides: Partial<Parameters<typeof verifyPortalSignature>[0]> = {}) {
  return verifyPortalSignature({
    secret,
    rawBody: body,
    timestampHeader: timestamp,
    signatureHeader: signature,
    nowSeconds: now,
    ...overrides,
  });
}

describe('signPortalRequest', () => {
  it('ger exakt kontraktets signatur, räknad oberoende av CRM:ets kod', () => {
    expect(signPortalRequest(secret, body, now)).toEqual({
      [PORTAL_TIMESTAMP_HEADER]: timestamp,
      [PORTAL_SIGNATURE_HEADER]: signature,
    });
  });

  it('använder header-namnen i kontraktet', () => {
    expect(PORTAL_TIMESTAMP_HEADER).toBe('X-Ekovilla-Timestamp');
    expect(PORTAL_SIGNATURE_HEADER).toBe('X-Ekovilla-Signature');
  });

  it('signerar byte som en UTF-8-sträng — samma signatur för strängen och dess byte', () => {
    const fromBytes = signPortalRequest(secret, new TextEncoder().encode(body), now);
    expect(fromBytes[PORTAL_SIGNATURE_HEADER]).toBe(signature);
  });

  it('avrundar klockan nedåt till hela sekunder', () => {
    expect(signPortalRequest(secret, body, now + 0.9)[PORTAL_TIMESTAMP_HEADER]).toBe(timestamp);
  });

  it('vägrar signera med en tom eller kort hemlighet — en sådan signatur går att gissa', () => {
    expect(() => signPortalRequest('', body, now)).toThrow();
    expect(() => signPortalRequest('för-kort', body, now)).toThrow();
  });
});

describe('verifyPortalSignature', () => {
  it('godtar kontraktets signatur', () => {
    expect(verify()).toEqual({ ok: true });
  });

  it('godtar ett helt jobb som signerats och skickats oförändrat', () => {
    const raw = JSON.stringify(CONTRACT_JOB);
    const headers = signPortalRequest(secret, raw, now);
    expect(
      verify({ rawBody: raw, timestampHeader: headers[PORTAL_TIMESTAMP_HEADER], signatureHeader: headers[PORTAL_SIGNATURE_HEADER] }),
    ).toEqual({ ok: true });
  });

  it('nekar samma innehåll serialiserat om — signaturen gäller den råa kroppen', () => {
    const raw = JSON.stringify(CONTRACT_JOB);
    const headers = signPortalRequest(secret, raw, now);
    const reserialized = JSON.stringify(JSON.parse(raw), null, 2);
    expect(
      verify({ rawBody: reserialized, timestampHeader: headers[PORTAL_TIMESTAMP_HEADER], signatureHeader: headers[PORTAL_SIGNATURE_HEADER] }),
    ).toEqual({ ok: false, reason: 'signature_mismatch' });
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

  it('säger att hemligheten saknas i stället för att pröva mot en tom — det blir 503, inte 401', () => {
    expect(verify({ secret: '' })).toEqual({ ok: false, reason: 'secret_not_configured' });
    expect(verify({ secret: null })).toEqual({ ok: false, reason: 'secret_not_configured' });
    expect(verify({ secret: 'för-kort' })).toEqual({ ok: false, reason: 'secret_not_configured' });
  });
});
