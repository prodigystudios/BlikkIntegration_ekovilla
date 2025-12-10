import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

type NoteRow = {
  id: string;
  note_day: string; // ISO date (YYYY-MM-DD)
  text: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');

    if (!start || !end) {
      return NextResponse.json({ error: 'Missing start or end' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('planning_day_notes')
      .select('*')
      .gte('note_day', start)
      .lte('note_day', end)
      .order('note_day', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ notes: (data ?? []) as NoteRow[] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await request.json();
    const { note_day, text, created_by, created_by_name, id } = body ?? {};

    if (!note_day || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing note_day or text' }, { status: 400 });
    }

    const upsertRow = {
      id: id ?? undefined,
      note_day,
      text,
      created_by: created_by ?? null,
      created_by_name: created_by_name ?? null,
    };

    const { data, error } = await supabase
      .from('planning_day_notes')
      .upsert(upsertRow, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ note: data as NoteRow });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const note_day = searchParams.get('note_day');

    if (!id && !note_day) {
      return NextResponse.json({ error: 'Provide id or note_day' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    let query = supabase.from('planning_day_notes').delete();
    if (id) query = query.eq('id', id);
    if (note_day) query = query.eq('note_day', note_day);

    const { error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
