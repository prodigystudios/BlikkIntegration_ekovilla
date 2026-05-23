import { NextResponse } from 'next/server';
import { getWebPushPublicKey, isWebPushConfigured } from '@/lib/webPush';

function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
      ...(details !== undefined ? { details } : {}),
    },
    { status },
  );
}

export async function GET() {
  if (!isWebPushConfigured()) {
    return routeError(503, 'push_not_configured', 'Push is not configured.');
  }

  const payload = { publicKey: getWebPushPublicKey() };
  return ok(payload, payload);
}