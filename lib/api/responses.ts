import { NextResponse } from 'next/server';
import { z } from 'zod';

// Shared HTTP response helpers for non-CRM API routes. Mirrors the shape used by the CRM
// surface (app/api/crm/_shared.ts) exactly — `error` is the human string the client toasts,
// `errorDetails` carries the machine-readable { code, message, details }. Kept identical so the
// whole app parses one response shape; do not introduce a third variant.

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

// Guards a dynamic [id] path segment before it reaches a `.eq('id', …)` query. A non-UUID id
// otherwise makes Postgres throw 22P02, surfacing as a raw 500. Returns a 400 to return early,
// or null when the id is valid.
export function invalidUuidParam(id: string | undefined) {
  return id && UUID_RE.test(id) ? null : routeError(400, 'invalid_id', 'Ogiltigt id.');
}

// PostgREST returns PGRST116 from `.single()` when a statement matched no rows — the row is
// missing OR hidden by RLS. Lets callers answer 403/404 deliberately instead of leaking a 500.
export function isNoRowsError(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST116';
}

// PDF-rutterna öppnas som en vanlig fliknavigering, inte via fetch — det är enda sättet att
// låta webbläsaren se `Content-Disposition` och därmed spara filen med rätt namn (en
// blob-URL bär inget namn alls och blir "Unknown"). Priset är att ett felsvar hamnar i
// fliken i stället för i en toast, så ett fel på en dokumentnavigering svaras ut som en
// liten HTML-sida i stället för som JSON.
export function isDocumentNavigation(req: Request): boolean {
  const dest = req.headers.get('sec-fetch-dest');
  // Sec-Fetch-Dest finns i alla nuvarande webbläsare; Accept är fallbacken för äldre.
  if (dest) return dest === 'document';
  return (req.headers.get('accept') || '').includes('text/html');
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

export function documentErrorPage(status: number, message: string) {
  const body = `<!doctype html><html lang="sv"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>Kunde inte hämta dokumentet</title>`
    + `<style>body{margin:0;display:grid;place-items:center;min-height:100vh;`
    + `font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f8faf6;color:#1e293b}`
    + `main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.125rem;margin:0 0 .5rem}`
    + `p{margin:0;color:#475569;line-height:1.6}</style></head><body><main>`
    + `<h1>Kunde inte hämta dokumentet</h1><p>${escapeHtml(message)}</p>`
    + `<p>Stäng fliken och försök igen.</p></main></body></html>`;
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
