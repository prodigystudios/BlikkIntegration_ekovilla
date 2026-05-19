import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminSupabase } from '@/lib/adminSupabase';
import { getBlikk } from '@/lib/blikk';
import { sendEmail } from '@/lib/email';
import { buildPlanningNotificationEmail } from '@/lib/planningNotificationEmail';
import { getPublicOrigin } from '@/lib/publicOrigin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NotifySchema = z.object({
  projectId: z.string().trim().min(1),
  segmentId: z.string().trim().min(1),
  recipientEmail: z.string().trim().email(),
  recipientSource: z.enum(['detected', 'manual']).default('detected'),
  startDay: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDay: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  truck: z.string().trim().min(1).nullable().optional(),
  orderInDay: z.number().int().positive().nullable().optional(),
  totalInDay: z.number().int().positive().nullable().optional(),
  projectName: z.string().trim().min(1),
  customerName: z.string().trim().nullable().optional(),
  orderNumber: z.string().trim().nullable().optional(),
  salesResponsible: z.string().trim().nullable().optional(),
  customMessage: z.string().trim().max(2000).nullable().optional(),
  actorUserId: z.string().trim().nullable().optional(),
  actorUserName: z.string().trim().nullable().optional(),
});

function env(name: string): string {
  return (process.env[name] || '').trim();
}

function firstEmail(value: unknown): string | null {
  if (!value) return null;
  const list = Array.isArray(value) ? value : [value];
  for (const entry of list) {
    const text = String(entry || '').trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return text;
  }
  return null;
}

async function resolveCustomerEmail(projectId: string): Promise<string | null> {
  const numericProjectId = Number(projectId);
  if (!Number.isFinite(numericProjectId) || numericProjectId <= 0) return null;

  const blikk = getBlikk();
  const projectData: any = await blikk.getProjectById(numericProjectId);
  const customerIdCandidates = [
    projectData?.customerId,
    projectData?.contactId,
    projectData?.clientId,
    projectData?.CustomerId,
    projectData?.customer?.id,
    projectData?.contact?.id,
    projectData?.client?.id,
  ].map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);

  const customerId = customerIdCandidates[0];
  if (!customerId) return null;

  const contactData: any = await blikk.getContactById(customerId);
  return firstEmail([
    contactData?.contact?.email,
    contactData?.contact?.Email,
    contactData?.contact?.contactEmail,
    contactData?.contact?.emailCandidates,
  ]);
}

function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^\d+]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('0')) return `+46${cleaned.slice(1)}`;
  return cleaned.startsWith('46') ? `+${cleaned}` : cleaned;
}

function normalizePersonName(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function findSellerContactInSupabase(sellerName: string | null) {
  if (!adminSupabase || !sellerName) return null;
  const normalized = normalizePersonName(sellerName);
  if (!normalized) return null;

  const { data, error } = await adminSupabase
    .from('contacts')
    .select('name, phone, role, location')
    .not('phone', 'is', null)
    .order('name', { ascending: true });

  if (error || !Array.isArray(data)) return null;

  const exact = data.find((entry: any) => normalizePersonName(entry?.name) === normalized);
  if (exact) return exact;

  return data.find((entry: any) => {
    const candidate = normalizePersonName(entry?.name);
    return candidate.includes(normalized) || normalized.includes(candidate);
  }) || null;
}

async function findSellerUserInSupabase(sellerName: string | null) {
  if (!adminSupabase || !sellerName) return null;
  const normalized = normalizePersonName(sellerName);
  if (!normalized) return null;

  const { data: authUsers, error: usersErr } = await adminSupabase.auth.admin.listUsers();
  if (usersErr || !authUsers?.users?.length) return null;

  const ids = authUsers.users.map((user) => user.id);
  const { data: profiles, error: profilesErr } = await adminSupabase
    .from('profiles')
    .select('id, role, full_name, phone')
    .in('id', ids)
    .in('role', ['sales', 'admin']);
  if (profilesErr || !Array.isArray(profiles)) return null;

  const authEmailById = new Map<string, string | null>();
  for (const user of authUsers.users) authEmailById.set(user.id, user.email || null);

  const exact = profiles.find((entry: any) => normalizePersonName(entry?.full_name) === normalized);
  if (exact) {
    return {
      email: authEmailById.get(exact.id) || null,
      phone: normalizePhone(exact.phone || null),
      name: exact.full_name || null,
    };
  }

  const fuzzy = profiles.find((entry: any) => {
    const candidate = normalizePersonName(entry?.full_name);
    return candidate.includes(normalized) || normalized.includes(candidate);
  });
  if (!fuzzy) return null;

  return {
    email: authEmailById.get(fuzzy.id) || null,
    phone: normalizePhone(fuzzy.phone || null),
    name: fuzzy.full_name || null,
  };
}

function deriveSellerInfo(projectData: any, fallbackName: string | null) {
  const pickSeller = (input: any) => {
    if (!input) return { name: null as string | null, email: null as string | null, phone: null as string | null };
    if (typeof input === 'string') return { name: input, email: null, phone: null };
    if (Array.isArray(input)) {
      const names = input.map((entry: any) => entry?.name || entry?.fullName || entry?.title || null).filter(Boolean);
      const firstWithContact = input.find((entry: any) => entry && (entry.email || entry.mail || entry.phone || entry.mobilePhone || entry.mobile || entry.phoneNumber));
      return {
        name: names.length ? names.join(', ') : null,
        email: firstWithContact?.email || firstWithContact?.mail || null,
        phone: firstWithContact?.phone || firstWithContact?.mobilePhone || firstWithContact?.mobile || firstWithContact?.phoneNumber || null,
      };
    }
    if (typeof input === 'object') {
      return {
        name: input.name || input.fullName || input.title || null,
        email: input.email || input.mail || null,
        phone: input.phone || input.mobilePhone || input.mobile || input.phoneNumber || null,
      };
    }
    return { name: null, email: null, phone: null };
  };

  const picked = pickSeller(projectData?.salesResponsible || projectData?.salesResponsibleUser || projectData?.salesUser || projectData?.salesRep || projectData?.responsibleSalesUser);
  return {
    name: picked.name || projectData?.salesResponsibleName || projectData?.salesResponsibleFullName || fallbackName || null,
    email: picked.email || projectData?.salesResponsibleEmail || projectData?.salesEmail || projectData?.responsibleSalesEmail || null,
    phone: normalizePhone(picked.phone || projectData?.salesResponsiblePhone || projectData?.salesPhone || projectData?.responsibleSalesPhone || projectData?.salesResponsibleMobile || projectData?.salesMobile || null),
  };
}

export async function POST(req: NextRequest) {
  try {
    if (!adminSupabase) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
    }

    const parsed = NotifySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
    }

    const data = parsed.data;
    const numericProjectId = Number(data.projectId);
    const projectData = Number.isFinite(numericProjectId) && numericProjectId > 0
      ? await getBlikk().getProjectById(numericProjectId).catch(() => null)
      : null;
    let recipientEmail = data.recipientEmail;
    if (data.recipientSource === 'detected') {
      const resolved = projectData ? await resolveCustomerEmail(data.projectId).catch(() => null) : null;
      recipientEmail = resolved || recipientEmail;
    }

    if (!recipientEmail) {
      return NextResponse.json({ error: 'Ingen giltig mottagaradress hittades.' }, { status: 400 });
    }

    const sender = env('PLANNING_MAIL_FROM') || 'bokning@ekovilla.se';
    const sellerInfoBase = deriveSellerInfo(projectData, data.salesResponsible || null);
    const sellerUserMatch = await findSellerUserInSupabase(sellerInfoBase.name || data.salesResponsible || null).catch(() => null);
    const sellerDirectoryMatch = sellerInfoBase.phone ? null : await findSellerContactInSupabase(sellerInfoBase.name || data.salesResponsible || null).catch(() => null);
    const sellerInfo = {
      ...sellerInfoBase,
      name: sellerUserMatch?.name || sellerInfoBase.name,
      email: sellerUserMatch?.email || sellerInfoBase.email,
      phone: sellerUserMatch?.phone || sellerInfoBase.phone || normalizePhone(sellerDirectoryMatch?.phone || null),
    };
    const origin = getPublicOrigin(req);
    const email = buildPlanningNotificationEmail({
      recipientEmail,
      projectName: data.projectName,
      customerName: data.customerName || null,
      orderNumber: data.orderNumber || null,
      startDay: data.startDay,
      endDay: data.endDay,
      truck: data.truck || null,
      salesResponsible: sellerInfo.name || data.salesResponsible || null,
      orderInDay: data.orderInDay ?? null,
      totalInDay: data.totalInDay ?? null,
      customMessage: data.customMessage || null,
      sellerEmail: sellerInfo.email,
      sellerPhone: sellerInfo.phone,
      logoUrl: `${origin}/brand/Ekovilla_vit.png`,
    });

    await sendEmail({
      to: recipientEmail,
      from: sender,
      replyTo: sender,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    const actor = data.actorUserName || data.actorUserId || 'okänd';
    const ts = new Date().toISOString();
    const { error: metaError } = await adminSupabase.from('planning_project_meta').upsert({
      project_id: data.projectId,
      client_notified: true,
      client_notified_at: ts,
      client_notified_by: actor,
    });
    if (metaError) throw metaError;

    return NextResponse.json({ ok: true, recipientEmail, clientNotifiedAt: ts, clientNotifiedBy: actor });
  } catch (e: any) {
    console.error('[api/planning/notify-customer] error', e);
    return NextResponse.json({ error: String(e?.message || e || 'Unknown error') }, { status: 500 });
  }
}