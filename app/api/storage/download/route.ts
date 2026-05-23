import { NextRequest, NextResponse } from 'next/server';
import { downloadQuerySchema, getStorageAdminOrThrow, routeError, sanitizeStoragePath } from '../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const parsedQuery = downloadQuerySchema.safeParse({
      path: req.nextUrl.searchParams.get('path') || undefined,
    });
    if (!parsedQuery.success) {
      return routeError(400, 'validation_error', 'Missing path', parsedQuery.error.flatten());
    }

    const supa = getStorageAdminOrThrow();
    const bucket = process.env.SUPABASE_BUCKET || 'pdfs';
    const path = sanitizeStoragePath(parsedQuery.data.path);

    const { data, error } = await supa.storage.from(bucket).download(path);
    if (error || !data) {
      return routeError(404, 'storage_file_not_found', error?.message || 'File not found');
    }

  const fileName = path.split('/').pop() || 'file';
  const arr = await data.arrayBuffer();

  return new NextResponse(arr, {
      status: 200,
      headers: {
        'Content-Type': data.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName).replace(/%20/g, ' ')}"`,
        'Cache-Control': 'private, max-age=0, must-revalidate',
      },
    });
  } catch (err: any) {
    const message = err?.message === 'Invalid path' ? 'Invalid path' : err.message;
    const status = err?.message === 'Invalid path' ? 400 : 500;
    return routeError(status, status === 400 ? 'validation_error' : 'storage_download_failed', message);
  }
}
