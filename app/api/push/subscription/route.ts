import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { z } from 'zod';

type SubscriptionPayload = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

const subscriptionBodySchema = z.object({
  subscription: z.object({
    endpoint: z.string().trim().min(1, 'Ogiltig push subscription.'),
    keys: z.object({
      p256dh: z.string().trim().min(1, 'Ogiltig push subscription.'),
      auth: z.string().trim().min(1, 'Ogiltig push subscription.'),
    }),
  }),
  userAgent: z.string().max(500).optional(),
});

const unsubscribeBodySchema = z.object({
  endpoint: z.string().trim().min(1, 'Endpoint krävs.'),
});

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

async function getAuthedSupabase() {
  const supabase = createRouteHandlerClient({ cookies });
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
    return routeError(401, 'unauthorized', 'Ej inloggad.');
  }

  const parsedBody = subscriptionBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return routeError(400, 'validation_error', 'Ogiltig push subscription.', parsedBody.error.flatten());
  }

  const endpoint = parsedBody.data.subscription.endpoint;
  const p256dh = parsedBody.data.subscription.keys.p256dh;
  const auth = parsedBody.data.subscription.keys.auth;
  const userAgent = parsedBody.data.userAgent?.slice(0, 500) || null;

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
    return routeError(500, 'push_subscription_upsert_failed', error.message);
  }

  return ok({ saved: true }, { saved: true });
}

export async function DELETE(req: NextRequest) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) {
    return routeError(401, 'unauthorized', 'Ej inloggad.');
  }

  const parsedBody = unsubscribeBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return routeError(400, 'validation_error', 'Endpoint krävs.', parsedBody.error.flatten());
  }

  const endpoint = parsedBody.data.endpoint;

  const { error } = await supabase.from('dashboard_push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
  if (error) {
    return routeError(500, 'push_subscription_delete_failed', error.message);
  }

  return ok({ removed: true }, { removed: true });
}