import { NextRequest } from 'next/server';
import { getBlikk } from '@/lib/blikk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
  const { projectId, text } = await req.json();
    if (!projectId || !text) {
      return new Response(JSON.stringify({ error: 'Missing projectId or text' }), { status: 400 });
    }
  // Optionally append default mentions from env (comma-separated, e.g. "@patrikvall,@someone")
  const mentionsRaw = process.env.BLIKK_COMMENT_MENTIONS || '';
  const mentions = mentionsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const finalText = mentions.length ? `${text} ${mentions.join(' ')}` : text;
  console.log('[blikk/comment] posting', { projectId, length: finalText.length });
    const blikk = getBlikk();
  const result = await blikk.addProjectComment(Number(projectId), String(finalText));
    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[blikk/comment] error', e);
    return new Response(JSON.stringify({ error: e.message || 'Failed to post comment' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
