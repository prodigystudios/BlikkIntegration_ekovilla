import React from 'react';
import { redirect } from 'next/navigation';
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
    <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: 12, padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 12, color: '#111827', whiteSpace: 'pre-wrap' }}>{value || '—'}</div>
    </div>
  );
}

export default async function AdminOffertCustomerResponsePage({ params }: { params: { offertId: string } }) {
  const profile = await getUserProfile();
  if (!profile || profile.role !== 'admin') redirect('/');
  if (!adminSupabase) return <div style={{ padding: 16 }}>Admin supabase not configured.</div>;

  const offertId = String(params?.offertId || '').trim();
  if (!offertId) return <div style={{ padding: 16 }}>Missing offertId.</div>;

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
    return <div style={{ padding: 16 }}>Kunde inte hämta kundlänk: {reqErr.message}</div>;
  }

  if (!latestReq) {
    return (
      <div style={{ padding: 16, maxWidth: 980, margin: '0 auto', display: 'grid', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Kunduppgifter</h1>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Inget kundsvar hittades för den här offerten.</p>
      </div>
    );
  }

  const { data: resp, error: respErr } = await adminSupabase
    .from('offert_customer_responses')
    .select('*')
    .eq('request_id', latestReq.id)
    .maybeSingle();

  if (respErr) {
    return <div style={{ padding: 16 }}>Kunde inte hämta kundsvar: {respErr.message}</div>;
  }

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: '0 auto', display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Kunduppgifter (admin)</h1>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
          Offert: {offer?.name || offertId}{offertNumber ? ` (${offertNumber})` : ''}
        </p>
      </div>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
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
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
        <strong style={{ fontSize: 13 }}>PERSONER</strong>
        <div style={{ marginTop: 8 }}>
          <Row label="Namn (1)" value={resp?.person1_name} />
          <Row label="Personnummer (1)" value={resp?.person1_personnummer} />
          <Row label="Namn (2)" value={resp?.person2_name} />
          <Row label="Personnummer (2)" value={resp?.person2_personnummer} />
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
        <strong style={{ fontSize: 13 }}>LEVERANS</strong>
        <div style={{ marginTop: 8 }}>
          <Row label="Leveransadress" value={resp?.delivery_address} />
          <Row label="Postnummer" value={resp?.postal_code} />
          <Row label="Ort" value={resp?.city} />
          <Row label="Fastighetsbeteckning" value={resp?.property_designation} />
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
        <strong style={{ fontSize: 13 }}>KONTAKT</strong>
        <div style={{ marginTop: 8 }}>
          <Row label="Telefon" value={resp?.phone} />
          <Row label="E-post" value={resp?.email} />
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
        <strong style={{ fontSize: 13 }}>ÖVRIGT</strong>
        <div style={{ marginTop: 8 }}>
          <Row label="Befintlig isolering" value={resp?.existing_insulation} />
          <Row label="Typ av vindslucka" value={resp?.attic_hatch_type} />
          <Row label="Övrigt" value={resp?.other_info} />
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff' }}>
        <strong style={{ fontSize: 13 }}>SIGNATUR</strong>
        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
          <Row label="Signerat" value={resp?.signature_signed_at ? new Date(resp.signature_signed_at).toLocaleString('sv-SE') : '—'} />
          {resp?.signature_data_url ? (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, background: '#fff' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Signatur" src={resp.signature_data_url} style={{ width: '100%', height: 'auto', display: 'block' }} />
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#64748b' }}>Ingen signatur sparad.</div>
          )}
        </div>
      </section>

      <div style={{ fontSize: 12, color: '#64748b' }}>
        Snabböppna offert: <a href={`/offert/kalkylator?load=${encodeURIComponent(offertId)}`}>/offert/kalkylator?load=…</a>
      </div>
    </div>
  );
}
