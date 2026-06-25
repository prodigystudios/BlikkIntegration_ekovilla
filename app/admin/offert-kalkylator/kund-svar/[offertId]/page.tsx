import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import PageShell from '../../../../../components/ui/PageShell';
import SectionCard from '../../../../../components/ui/SectionCard';
import { getUserProfile } from '@/lib/getUserProfile';
import { adminSupabase } from '@/lib/adminSupabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function formatOffertNumber(year: any, seq: any) {
  const y = Number(year);
  const s = Number(seq);
  if (!Number.isFinite(y) || !Number.isFinite(s) || y <= 0 || s <= 0) return '';
  return `${y}-${String(Math.trunc(s)).padStart(5, '0')}`;
}

function formatKr(value: any) {
  const v = Number(value);
  const n = Number.isFinite(v) ? v : 0;
  return `${Math.round(n).toLocaleString('sv-SE')} kr`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-slate-200 py-2 md:grid-cols-[180px_minmax(0,1fr)] md:gap-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="whitespace-pre-wrap text-xs text-slate-900">{value || '—'}</div>
    </div>
  );
}

function MessagePage({ title, body }: { title: string; body: string }) {
  return (
    <PageShell className="max-w-[980px] gap-4">
      <SectionCard className="grid gap-2 p-5">
        <h1 className="m-0 text-lg text-slate-900">{title}</h1>
        <p className="m-0 text-sm text-slate-500">{body}</p>
      </SectionCard>
    </PageShell>
  );
}

export default async function AdminOffertCustomerResponsePage({ params }: { params: { offertId: string } }) {
  const profile = await getUserProfile();
  if (!profile || profile.role !== 'admin') redirect('/');
  if (!adminSupabase) return <MessagePage title="Kunduppgifter" body="Admin supabase not configured." />;

  const offertId = String(params?.offertId || '').trim();
  if (!offertId) return <MessagePage title="Kunduppgifter" body="Missing offertId." />;

  const { data: offer } = await adminSupabase
    .from('offert_calculations')
    .select('id, offert_number_year, offert_number_seq, name, address, city, salesperson, salesperson_phone, created_at, total_before_rot, rot_amount, total_after_rot')
    .eq('id', offertId)
    .maybeSingle();

  const offertNumber = formatOffertNumber((offer as any)?.offert_number_year, (offer as any)?.offert_number_seq);

  const { data: latestReq, error: reqErr } = await adminSupabase
    .from('offert_customer_requests')
    .select('id, status, created_at, submitted_at, seller_email')
    .eq('offert_id', offertId)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reqErr) {
    return <MessagePage title="Kunduppgifter" body={`Kunde inte hämta kundlänk: ${reqErr.message}`} />;
  }

  if (!latestReq) {
    return <MessagePage title="Kunduppgifter" body="Inget kundsvar hittades för den här offerten." />;
  }

  const { data: resp, error: respErr } = await adminSupabase
    .from('offert_customer_responses')
    .select('*')
    .eq('request_id', latestReq.id)
    .maybeSingle();

  if (respErr) {
    return <MessagePage title="Kunduppgifter" body={`Kunde inte hämta kundsvar: ${respErr.message}`} />;
  }

  return (
    <PageShell className="max-w-[980px] gap-3">
      <div className="grid gap-1">
        <h1 className="m-0 text-lg text-slate-900">Kunduppgifter (admin)</h1>
        <p className="m-0 text-xs text-slate-500">
          Offert: {offer?.name || offertId}{offertNumber ? ` (${offertNumber})` : ''}
        </p>
      </div>

      <SectionCard className="p-3">
        <Row label="Offert" value={offer?.name || offertId} />
        {offertNumber && <Row label="Offertnummer" value={offertNumber} />}
        <Row label="Vår referens" value={offer?.salesperson || '—'} />
        {String((offer as any)?.salesperson_phone || '').trim() && (
          <Row label="Telefonnummer" value={String((offer as any).salesperson_phone).trim()} />
        )}
        <Row label="Säljare email" value={latestReq.seller_email || '—'} />
        <Row label="Adress" value={[offer?.address, offer?.city].filter(Boolean).join(', ')} />
        <Row label="Totalsumma (innan ROT)" value={formatKr((offer as any)?.total_before_rot)} />
        <Row label="ROT" value={`- ${formatKr((offer as any)?.rot_amount)}`} />
        <Row label="Totalsumma (efter ROT)" value={formatKr((offer as any)?.total_after_rot)} />
        <Row label="Inskickad" value={latestReq.submitted_at ? new Date(latestReq.submitted_at).toLocaleString('sv-SE') : '—'} />
      </SectionCard>

      <SectionCard className="grid gap-2 p-3">
        <strong className="text-[13px] text-slate-900">PERSONER</strong>
        <div className="mt-1 grid gap-0">
          <Row label="Namn (1)" value={resp?.person1_name} />
          <Row label="Personnummer (1)" value={resp?.person1_personnummer} />
          <Row label="Namn (2)" value={resp?.person2_name} />
          <Row label="Personnummer (2)" value={resp?.person2_personnummer} />
        </div>
      </SectionCard>

      <SectionCard className="grid gap-2 p-3">
        <strong className="text-[13px] text-slate-900">LEVERANS</strong>
        <div className="mt-1 grid gap-0">
          <Row label="Leveransadress" value={resp?.delivery_address} />
          <Row label="Postnummer" value={resp?.postal_code} />
          <Row label="Ort" value={resp?.city} />
          <Row label="Fastighetsbeteckning" value={resp?.property_designation} />
        </div>
      </SectionCard>

      <SectionCard className="grid gap-2 p-3">
        <strong className="text-[13px] text-slate-900">KONTAKT</strong>
        <div className="mt-1 grid gap-0">
          <Row label="Telefon" value={resp?.phone} />
          <Row label="E-post" value={resp?.email} />
        </div>
      </SectionCard>

      <SectionCard className="grid gap-2 p-3">
        <strong className="text-[13px] text-slate-900">ÖVRIGT</strong>
        <div className="mt-1 grid gap-0">
          <Row label="Befintlig isolering" value={resp?.existing_insulation} />
          <Row label="Typ av vindslucka" value={resp?.attic_hatch_type} />
          <Row label="Övrigt" value={resp?.other_info} />
        </div>
      </SectionCard>

      <SectionCard className="grid gap-2 p-3">
        <strong className="text-[13px] text-slate-900">SIGNATUR</strong>
        <div className="mt-1 grid gap-2">
          <Row label="Signerat" value={resp?.signature_signed_at ? new Date(resp.signature_signed_at).toLocaleString('sv-SE') : '—'} />
          {resp?.signature_data_url ? (
            <div className="rounded-xl border border-slate-200 bg-white p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Signatur" src={resp.signature_data_url} className="block h-auto w-full" />
            </div>
          ) : (
            <div className="text-xs text-slate-500">Ingen signatur sparad.</div>
          )}
        </div>
      </SectionCard>

      <div className="text-xs text-slate-500">
        Snabböppna offert: <Link href={`/offert/kalkylator?load=${encodeURIComponent(offertId)}`} className="text-emerald-700 underline underline-offset-2">/offert/kalkylator?load=…</Link>
      </div>
    </PageShell>
  );
}
