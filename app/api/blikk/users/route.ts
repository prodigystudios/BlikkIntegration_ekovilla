import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || undefined;
    const page = Number(searchParams.get('page') || '1');
    const pageSize = Number(searchParams.get('pageSize') || '50');
    const blikk = getBlikk();
    const users = await blikk.listUsers({ query, page, pageSize });
    return NextResponse.json(users);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to list users' }, { status: 500 });
  }
}
