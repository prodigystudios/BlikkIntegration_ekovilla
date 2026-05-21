import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/adminSupabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function env(name: string): string {
  return (process.env[name] || '').trim();
}

function getRequestUrl(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (!host) return req.url;
  return `${proto}://${host}${req.nextUrl.pathname}`;
}

function firstField(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function POST(req: NextRequest) {
  try {
    if (!adminSupabase) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
    }

    const authToken = env('TWILIO_AUTH_TOKEN');
    const signature = req.headers.get('x-twilio-signature') || '';
    if (!authToken || !signature) {
      return NextResponse.json({ error: 'Missing Twilio signature configuration' }, { status: 401 });
    }

    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') params[key] = value;
    }

    const twilioModule = await import('twilio');
    const isValid = twilioModule.validateRequest(authToken, signature, getRequestUrl(req), params);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 });
    }

    const messageSid = firstField(form.get('MessageSid'));
    const messageStatus = firstField(form.get('MessageStatus'));
    const errorCode = firstField(form.get('ErrorCode'));
    const errorMessage = firstField(form.get('ErrorMessage'));

    if (!messageSid || !messageStatus) {
      return NextResponse.json({ error: 'Missing Twilio payload fields' }, { status: 400 });
    }

    const { error } = await adminSupabase
      .from('planning_project_meta')
      .update({
        sms_delivery_status: messageStatus,
        sms_last_error: errorMessage || errorCode || null,
      })
      .eq('sms_provider_message_id', messageSid);

    if (error) throw error;

    return new NextResponse(null, { status: 204 });
  } catch (e: any) {
    console.error('[api/twilio/sms-status] error', e);
    return NextResponse.json({ error: String(e?.message || e || 'Unknown error') }, { status: 500 });
  }
}
