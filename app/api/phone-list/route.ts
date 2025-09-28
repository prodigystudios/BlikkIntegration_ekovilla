import { NextResponse } from 'next/server';
import { adminSupabase } from '../../../lib/adminSupabase';
import path from 'path';
import { promises as fs } from 'fs';

// Helper to load JSON either from storage bucket or fallback to bundled file
async function loadPhoneList(): Promise<any> {
  // Try Supabase storage (bucket: public-data, object: PhoneList.json)
  if (adminSupabase) {
    try {
      const { data, error } = await adminSupabase.storage.from('public-data').download('PhoneList.json');
      if (!error && data) {
        const text = await data.text();
        return JSON.parse(text);
      }
    } catch { /* ignore and fallback */ }
  }
  // Fallback: read from repo public/data/PhoneList.json
  try {
    const filePath = path.join(process.cwd(), 'public', 'data', 'PhoneList.json');
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { error: 'missing phone list' };
  }
}

export async function GET() {
  const json = await loadPhoneList();
  return NextResponse.json(json, { headers: { 'Cache-Control': 'no-store' } });
}
