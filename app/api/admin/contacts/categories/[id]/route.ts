import { NextRequest } from 'next/server';
import { ok, requireContactsAdminContext, routeError, routeIdParamsSchema, updateCategorySchema, validationError } from '../../_lib';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireContactsAdminContext();
  if ('response' in context) return context.response;

  const parsedParams = routeIdParamsSchema.safeParse(params);
  if (!parsedParams.success) return validationError(parsedParams.error);

  const body = await req.json();
  const parsed = updateCategorySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { supabase } = context;
  const { data, error } = await supabase.from('contact_categories').update(parsed.data).eq('id', parsedParams.data.id).select().single();
  if (error) return routeError(500, 'update_failed', error.message);
  return ok({ category: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const context = await requireContactsAdminContext();
  if ('response' in context) return context.response;

  const parsedParams = routeIdParamsSchema.safeParse(params);
  if (!parsedParams.success) return validationError(parsedParams.error);

  const { supabase } = context;
  const { error } = await supabase.from('contact_categories').delete().eq('id', parsedParams.data.id);
  if (error) return routeError(500, 'delete_failed', error.message);
  return ok(null);
}
