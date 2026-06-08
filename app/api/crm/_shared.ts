import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/route';

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function getFirstValidationMessage(parsedError: z.ZodError) {
  const flattened = parsedError.flatten();
  const fieldErrorGroups = Object.values(flattened.fieldErrors);

  for (const messages of fieldErrorGroups) {
    const firstMessage = messages?.find(Boolean);
    if (firstMessage) return firstMessage;
  }

  return flattened.formErrors.find(Boolean) || 'Invalid request';
}

export function validationError(parsedError: z.ZodError) {
  return routeError(400, 'validation_error', getFirstValidationMessage(parsedError), parsedError.flatten());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validates a dynamic [id] path segment as a UUID before it reaches a `.eq('id', …)` query.
// A non-UUID id otherwise makes Postgres throw 22P02 ("invalid input syntax for type uuid"),
// which surfaces as a 500 with a raw DB string. Returns the 400 response to return early, or
// null when the id is valid.
export function invalidUuidParam(id: string | undefined) {
  return id && UUID_RE.test(id) ? null : routeError(400, 'invalid_id', 'Ogiltigt id.');
}

// Keep only the fields the client actually sent. Zod schemas inject defaults for absent
// fields; persisting those on a partial PATCH would overwrite untouched columns with
// empties. The schema still validates the full (defaulted) object — we just write the
// sent subset. Shared by quote + work-order PATCH routes.
export function pickProvidedFields<T extends Record<string, unknown>>(parsed: T, rawBody: unknown): Partial<T> {
  const sentKeys = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? Object.keys(rawBody as object) : [];
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => sentKeys.includes(key))) as Partial<T>;
}

export async function requireCrmUser() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  // konsult has the same CRM rights as sales (external sellers working for us) — see lib/roles.ts.
  if (!(currentUser.role === 'sales' || currentUser.role === 'admin' || currentUser.role === 'konsult')) {
    return { currentUser: null, response: routeError(403, 'forbidden', 'Forbidden') };
  }

  return { currentUser, response: null };
}

// CRM WRITE access. konsult is a read-only role (the admin user-management UI stores a
// "readonly" choice as konsult, isReadonlyRole treats it as readonly, and planning blocks it
// from writes), so it must NOT create/edit CRM data or trigger Fortnox bookkeeping pushes —
// only sales/admin may. Use this on every CRM mutation (POST/PATCH/PUT/DELETE); use
// requireCrmUser for reads (where konsult may view).
export async function requireCrmWriter() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  if (!(currentUser.role === 'sales' || currentUser.role === 'admin')) {
    return { currentUser: null, response: routeError(403, 'forbidden', 'Forbidden') };
  }

  return { currentUser, response: null };
}

export async function requireCrmAdmin() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  if (currentUser.role !== 'admin') {
    return { currentUser: null, response: routeError(403, 'forbidden', 'Forbidden') };
  }

  return { currentUser, response: null };
}

export async function requireSignedInUser() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  return { currentUser, response: null };
}
