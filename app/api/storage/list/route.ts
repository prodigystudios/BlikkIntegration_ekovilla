import { NextRequest, NextResponse } from 'next/server';
import { getStorageAdminOrThrow, listQuerySchema, routeError, sanitizePrefix } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const parsedQuery = listQuerySchema.safeParse({
      prefix: req.nextUrl.searchParams.get('prefix') || undefined,
    });
    if (!parsedQuery.success) {
      return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
    }

    const supa = getStorageAdminOrThrow();
    const bucket = process.env.SUPABASE_BUCKET || 'pdfs';
    const prefix = sanitizePrefix(parsedQuery.data.prefix);

    const { data, error } = await supa.storage.from(bucket).list(prefix || undefined, {
      limit: 100,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error) return routeError(500, 'storage_list_failed', error.message);

    // Generate signed links for convenience
    const entries = await Promise.all((data || []).map(async (file) => {
      if (!file?.name) return null;
      const path = `${prefix ? prefix + '/' : ''}${file.name}`;
      // Use download option to force Content-Disposition=attachment
      const { data: signed } = await supa.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60 * 24 * 2, { download: file.name });
  const size = (file as any)?.metadata?.size ?? undefined;
  return { path, name: file.name, size, url: signed?.signedUrl };
    }));

    return NextResponse.json({ files: entries.filter(Boolean) }, { status: 200 });
  } catch (err: any) {
    return routeError(500, 'storage_list_failed', err.message);
  }
}
