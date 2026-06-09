import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth/route';
import { can, getEffectivePermissions, type PermissionKey } from '@/lib/auth/permissions';

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

// Permission-based gate. Resolves the user, then checks the effective permission set
// (role bundle ± per-user overrides) from the DB. Returns the same { currentUser, response }
// shape every CRM guard uses. This is the single primitive the role guards below wrap, and
// the one new per-resource routes should call directly (e.g. requirePermission('crm.offer.write')).
export async function requirePermission(key: PermissionKey) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  const perms = await getEffectivePermissions();
  if (!can(perms, key)) {
    return { currentUser: null, response: routeError(403, 'forbidden', 'Forbidden') };
  }

  return { currentUser, response: null };
}

// Legacy coarse guards, now thin wrappers over the permission layer. The seed in
// 20260608_permissions_model.sql gives crm.access to sales/konsult/admin, crm.write to
// sales/admin and crm.admin to admin — reproducing the old role checks exactly, so the ~170
// call sites are unchanged. Migrate hot routes to explicit per-resource keys over time.
export function requireCrmUser() {
  return requirePermission('crm.access');
}

// CRM WRITE access (sales/admin). konsult is read-only. Used on every CRM mutation.
export function requireCrmWriter() {
  return requirePermission('crm.write');
}

export function requireCrmAdmin() {
  return requirePermission('crm.admin');
}

export async function requireSignedInUser() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  return { currentUser, response: null };
}
