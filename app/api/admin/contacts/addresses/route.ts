import { NextRequest } from 'next/server';
import { createAddressSchema, ok, requireContactsAdminContext, routeError, validationError } from '../_lib';

export async function GET() {
  const context = await requireContactsAdminContext();
  if ('response' in context) return context.response;

  const { supabase } = context;
  const { data, error } = await supabase.from('addresses').select('*').order('sort').order('name');
  if (error) return routeError(500, 'query_failed', error.message);
  return ok({ addresses: data ?? [] });
}

export async function POST(req: NextRequest) {
  const context = await requireContactsAdminContext();
  if ('response' in context) return context.response;

  const body = await req.json();
  const parsed = createAddressSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { supabase } = context;
  const { data, error } = await supabase.from('addresses').insert(parsed.data).select().single();
  if (error) return routeError(500, 'insert_failed', error.message);
  return ok({ address: data }, 201);
}
