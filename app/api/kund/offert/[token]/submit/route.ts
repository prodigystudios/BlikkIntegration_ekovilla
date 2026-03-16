import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminSupabase } from '@/lib/adminSupabase';
import { hashCustomerToken } from '@/lib/offertCustomerTokens';
import { sendEmail } from '@/lib/email';
import { getPublicOrigin } from '@/lib/publicOrigin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SubmitSchema = z.object({
  person1Name: z.string().trim().max(200).optional().default(''),
  person1Personnummer: z.string().trim().max(50).optional().default(''),
  person2Name: z.string().trim().max(200).optional().default(''),
  person2Personnummer: z.string().trim().max(50).optional().default(''),
  deliveryAddress: z.string().trim().min(1).max(300),
  postalCode: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(100),
  propertyDesignation: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(50),
  email: z.string().trim().min(1).max(200),
  existingInsulation: z.string().trim().min(1).max(400),
  atticHatchType: z.enum(['inne', 'ute']),
  otherInfo: z.string().trim().max(2000).optional().default(''),
  signatureDataUrl: z.string().trim().min(1).max(250000),
}).superRefine((v, ctx) => {
  const p1Name = (v.person1Name || '').trim();
  const p1Pn = (v.person1Personnummer || '').trim();
  const p2Name = (v.person2Name || '').trim();
  const p2Pn = (v.person2Personnummer || '').trim();

  const p1HasAny = !!p1Name || !!p1Pn;
  const p2HasAny = !!p2Name || !!p2Pn;
  const p1Complete = !!p1Name && !!p1Pn;
  const p2Complete = !!p2Name && !!p2Pn;

  if (!p1Complete && !p2Complete) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Minst en person (namn + personnummer) krävs.' });
  }

  if (p1HasAny && !p1Complete) {
    if (!p1Name) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['person1Name'], message: 'Namn (person 1) krävs om person 1 används.' });
    if (!p1Pn) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['person1Personnummer'], message: 'Personnummer (person 1) krävs om person 1 används.' });
  }

  if (p2HasAny && !p2Complete) {
    if (!p2Name) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['person2Name'], message: 'Namn (person 2) krävs om person 2 används.' });
    if (!p2Pn) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['person2Personnummer'], message: 'Personnummer (person 2) krävs om person 2 används.' });
  }
});

function env(name: string): string {
  return (process.env[name] || '').trim();
}

export async function POST(req: NextRequest, ctx: { params: { token: string } }) {
  try {
    if (!adminSupabase) return NextResponse.json({ error: 'Server not configured' }, { status: 500 });

    const token = (ctx?.params?.token || '').trim();
    if (!token) return NextResponse.json({ error: 'Invalid link' }, { status: 404 });

    const parsed = SubmitSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid form data', details: parsed.error.flatten() }, { status: 400 });
    }

    const tokenHash = hashCustomerToken(token);

    const { data: requestRow, error: reqErr } = await adminSupabase
      .from('offert_customer_requests')
      .select('id, status, expires_at, revoked_at, offert_id, seller_email')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (reqErr) throw reqErr;
    if (!requestRow) return NextResponse.json({ error: 'Invalid link' }, { status: 404 });

    if (requestRow.revoked_at) return NextResponse.json({ error: 'Invalid link' }, { status: 410 });
    if (requestRow.expires_at && new Date(requestRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Link expired' }, { status: 410 });
    }
    if (requestRow.status !== 'pending') return NextResponse.json({ error: 'Already submitted' }, { status: 410 });

    const body = parsed.data;

    const { error: insErr } = await adminSupabase
      .from('offert_customer_responses')
      .insert({
        request_id: requestRow.id,
        person1_name: body.person1Name,
        person1_personnummer: body.person1Personnummer,
        person2_name: body.person2Name,
        person2_personnummer: body.person2Personnummer,
        delivery_address: body.deliveryAddress,
        postal_code: body.postalCode,
        city: body.city,
        property_designation: body.propertyDesignation,
        phone: body.phone,
        email: body.email,
        existing_insulation: body.existingInsulation,
        attic_hatch_type: body.atticHatchType,
        other_info: body.otherInfo || '',
        signature_data_url: body.signatureDataUrl,
      });

    if (insErr) throw insErr;

    const nowIso = new Date().toISOString();
    const { error: updErr } = await adminSupabase
      .from('offert_customer_requests')
      .update({ status: 'submitted', submitted_at: nowIso })
      .eq('id', requestRow.id)
      .eq('status', 'pending');

    if (updErr) throw updErr;

    const { data: offer } = await adminSupabase
      .from('offert_calculations')
      .select('id, name, address, city, salesperson')
      .eq('id', requestRow.offert_id)
      .maybeSingle();

    const origin = getPublicOrigin(req);

    const adminLink = `${origin}/admin/offert-kalkylator/kund-svar/${requestRow.offert_id}`;
    const sellerLink = `${origin}/offert/kalkylator?load=${requestRow.offert_id}`;

    const andreasTo = env('OFFERT_CUSTOMER_NOTIFY_TO');
    if (!andreasTo) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Missing OFFERT_CUSTOMER_NOTIFY_TO (required for notifications)');
      }
      console.warn('[offert customer submit] OFFERT_CUSTOMER_NOTIFY_TO missing; will only notify seller if available');
    }
    const recipients = [andreasTo, (requestRow.seller_email || '').trim()].filter(Boolean);

    const subject = `Kunduppgifter inskickade${offer?.name ? ` – ${offer.name}` : ''}`;

    const safeSummary = [
      offer?.name ? `Offert: ${offer.name}` : `Offert-ID: ${requestRow.offert_id}`,
      offer?.address ? `Adress: ${offer.address}, ${offer?.city || ''}`.trim() : null,
      body.person1Name ? `Kund 1: ${body.person1Name}` : null,
      body.person2Name ? `Kund 2: ${body.person2Name}` : null,
    ].filter(Boolean).join('\n');

    const html = `
      <p><strong>Kunden har fyllt i kunduppgifterna.</strong></p>
      <pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; white-space: pre-wrap;">${safeSummary.replace(/</g, '&lt;')}</pre>
      <p><a href="${adminLink}">Öppna kunduppgifter (admin)</a></p>
      <p><a href="${sellerLink}">Öppna offert (kalkylator)</a></p>
      <p style="color:#64748b; font-size:12px;">Av integritetsskäl skickas inte personnummer i mail.</p>
    `;

    if (recipients.length > 0) {
      await sendEmail({
        to: recipients,
        subject,
        html,
        text: `${safeSummary}\n\nAdmin: ${adminLink}\nOffert: ${sellerLink}\n\n(Personnummer skickas inte via mail.)`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}
