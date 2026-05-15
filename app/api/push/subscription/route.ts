import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';

type SubscriptionPayload = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

async function getAuthedSupabase() {
  const supabase = createServerComponentClient({ cookies });
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null as null };
  }
  return { supabase, user };
}

export async function POST(req: NextRequest) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Ej inloggad.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const subscription = (body?.subscription || null) as SubscriptionPayload | null;
  const endpoint = String(subscription?.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();
  const userAgent = typeof body?.userAgent === 'string' ? body.userAgent.slice(0, 500) : null;

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: false, error: 'Ogiltig push subscription.' }, { status: 400 });
  }

  const { error } = await supabase.from('dashboard_push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Ej inloggad.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const endpoint = String(body?.endpoint || '').trim();
  if (!endpoint) {
    return NextResponse.json({ ok: false, error: 'Endpoint krävs.' }, { status: 400 });
  }

  const { error } = await supabase.from('dashboard_push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}