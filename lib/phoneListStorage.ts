import path from 'path';
import { promises as fs } from 'fs';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

const phoneListObjectPath = 'PhoneList.json';
const phoneListBucket = 'public-data';

export const phoneListDocumentSchema = z.record(z.string(), z.unknown());

async function readBundledPhoneList() {
  try {
    const filePath = path.join(process.cwd(), 'public', 'data', phoneListObjectPath);
    const raw = await fs.readFile(filePath, 'utf8');
    return phoneListDocumentSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function loadPhoneListDocument(admin?: SupabaseClient | null) {
  if (admin) {
    try {
      const { data, error } = await admin.storage.from(phoneListBucket).download(phoneListObjectPath);
      if (!error && data) {
        const text = await data.text();
        return phoneListDocumentSchema.parse(JSON.parse(text));
      }
    } catch {
      // Fall through to bundled fallback.
    }
  }

  return readBundledPhoneList();
}

export async function savePhoneListDocument(admin: SupabaseClient, document: z.infer<typeof phoneListDocumentSchema>) {
  const payload = JSON.stringify(document, null, 2);
  const { error } = await admin.storage
    .from(phoneListBucket)
    .upload(phoneListObjectPath, new Blob([payload], { type: 'application/json' }), {
      upsert: true,
      contentType: 'application/json',
    });

  return error;
}