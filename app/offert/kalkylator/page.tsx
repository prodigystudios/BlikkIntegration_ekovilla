'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  computeOffertKalkylator,
  OFFERT_KALKYLATOR_DEFAULT_STATE,
  type OffertKalkylatorState,
  type IsoleringHojd,
  type UtsugningHojd,
} from '@/lib/offertKalkylator';
import { useToast } from '@/lib/Toast';
import { useUserProfile } from '@/lib/UserProfileContext';

function formatKr(value: number) {
  const v = Number.isFinite(value) ? value : 0;
  return `${Math.round(v).toLocaleString('sv-SE')} kr`;
}

function formatOffertNumber(year: any, seq: any) {
  const y = Number(year);
  const s = Number(seq);
  if (!Number.isFinite(y) || !Number.isFinite(s) || y <= 0 || s <= 0) return '';
  return `${y}-${String(Math.trunc(s)).padStart(5, '0')}`;
}

function toNum(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

function SelectNumber({
  value,
  onChange,
  max,
  suffix,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  max: number;
  suffix: string;
  disabled?: boolean;
}) {
  const options = useMemo(() => Array.from({ length: max + 1 }, (_, i) => i), [max]);
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
      <span style={{ color: '#334155' }}>{suffix}</span>
      <select
        className="select-field"
        value={String(value)}
        disabled={disabled}
        onChange={(e) => onChange(toNum(e.target.value))}
      >
        {options.map((n) => (
          <option key={n} value={String(n)}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

type CustomerResponseRow = {
  person1_name: string;
  person1_personnummer: string;
  person2_name: string;
  person2_personnummer: string;
  delivery_address: string;
  postal_code: string;
  city: string;
  property_designation: string;
  phone: string;
  email: string;
  existing_insulation: string;
  attic_hatch_type: string;
  other_info: string;
  signature_data_url: string;
  signature_signed_at?: string;
  submitted_at?: string;
};

function OffertKalkylatorInner() {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const profile = useUserProfile();
  const profileName = (profile?.full_name || '').trim();
  const profilePhone = String(profile?.phone || '').trim();
  const [state, setState] = useState<OffertKalkylatorState>(OFFERT_KALKYLATOR_DEFAULT_STATE);
  const [quoteName, setQuoteName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [quoteDate, setQuoteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [nextMeetingDate, setNextMeetingDate] = useState('');
  const [salesperson, setSalesperson] = useState('');
  const [salespersonPhone, setSalespersonPhone] = useState('');
  const [ovrigInfo, setOvrigInfo] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeCreatedAt, setActiveCreatedAt] = useState<string | null>(null);
  const [activeOffertNumber, setActiveOffertNumber] = useState<string | null>(null);
  const [hasLoadedOffer, setHasLoadedOffer] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [locatingAddress, setLocatingAddress] = useState(false);

  const [customerStatus, setCustomerStatus] = useState<'none' | 'pending' | 'submitted' | 'revoked'>('none');
  const [customerCreatedAt, setCustomerCreatedAt] = useState<string | null>(null);
  const [customerSubmittedAt, setCustomerSubmittedAt] = useState<string | null>(null);
  const [loadingCustomerData, setLoadingCustomerData] = useState(false);
  const [customerResponse, setCustomerResponse] = useState<CustomerResponseRow | null>(null);

  const lastAutoLoadedIdRef = useRef<string | null>(null);

  const totals = useMemo(() => computeOffertKalkylator(state), [state]);

  useEffect(() => {
    if (!profileName) return;
    setSalesperson(profileName);
  }, [profileName]);

  useEffect(() => {
    const p = String(profilePhone || '').trim();
    if (!p) return;
    setSalespersonPhone(p);
  }, [profilePhone]);

  useEffect(() => {
    if (!saveNotice) return;
    const t = setTimeout(() => setSaveNotice(null), 6500);
    return () => clearTimeout(t);
  }, [saveNotice]);

  const canSave = useMemo(() => {
    return !!quoteName.trim() && !!address.trim() && !!city.trim() && !!quoteDate.trim() && !!salesperson.trim();
  }, [quoteName, address, city, quoteDate, salesperson]);

  const showActiveSummary = useMemo(() => {
    return hasLoadedOffer;
  }, [hasLoadedOffer]);

  useEffect(() => {
    if (!activeId || !showActiveSummary) {
      setCustomerStatus('none');
      setCustomerCreatedAt(null);
      setCustomerSubmittedAt(null);
      setCustomerResponse(null);
      return;
    }

    let cancelled = false;
    setLoadingCustomerData(true);
    (async () => {
      try {
        const [statusRes, respRes] = await Promise.all([
          fetch(`/api/offert-kalkylator/${encodeURIComponent(activeId)}/customer-status`, { cache: 'no-store' }),
          fetch(`/api/offert-kalkylator/${encodeURIComponent(activeId)}/customer-response`, { cache: 'no-store' }),
        ]);

        const statusJson = await statusRes.json().catch(() => null);
        const respJson = await respRes.json().catch(() => null);

        if (cancelled) return;

        if (statusRes.ok) {
          const st = String(statusJson?.status || 'none');
          if (st === 'pending' || st === 'submitted' || st === 'revoked') setCustomerStatus(st);
          else setCustomerStatus('none');
          setCustomerCreatedAt(statusJson?.createdAt ? String(statusJson.createdAt) : null);
          setCustomerSubmittedAt(statusJson?.submittedAt ? String(statusJson.submittedAt) : null);
        } else {
          setCustomerStatus('none');
          setCustomerCreatedAt(null);
          setCustomerSubmittedAt(null);
        }

        if (respRes.ok) {
          setCustomerResponse((respJson?.response as any) || null);
          if (respJson?.submittedAt) setCustomerSubmittedAt(String(respJson.submittedAt));
        } else {
          setCustomerResponse(null);
        }
      } catch {
        if (cancelled) return;
        setCustomerStatus('none');
        setCustomerCreatedAt(null);
        setCustomerSubmittedAt(null);
        setCustomerResponse(null);
      } finally {
        if (!cancelled) setLoadingCustomerData(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeId, showActiveSummary]);

  const save = async () => {
    setSaveNotice(null);
    const name = quoteName.trim();
    const a = address.trim();
    const c = city.trim();
    const d = quoteDate.trim();
    const s = salesperson.trim();
    if (!name) return toast.error('Namn är obligatoriskt.');
    if (!a) return toast.error('Adress är obligatoriskt.');
    if (!c) return toast.error('Stad är obligatoriskt.');
    if (!d) return toast.error('Datum är obligatoriskt.');
    if (!s) return toast.error('Vår referens är obligatoriskt.');

    const payloadToSave: Partial<OffertKalkylatorState> & { ovrigInfo?: string } = { ...state };
    if (!(payloadToSave.isoleringKvm && payloadToSave.isoleringKvm > 0)) delete (payloadToSave as any).isoleringHojd;
    if (!(payloadToSave.utsugningKvm && payloadToSave.utsugningKvm > 0)) delete (payloadToSave as any).utsugningHojd;
    const extra = ovrigInfo.trim();
    if (extra) payloadToSave.ovrigInfo = extra;

    setSaving(true);
    try {
      const isUpdatingLoadedOffer = !!activeId && hasLoadedOffer;
      const res = await fetch(isUpdatingLoadedOffer ? `/api/offert-kalkylator/${encodeURIComponent(activeId)}` : '/api/offert-kalkylator', {
        method: isUpdatingLoadedOffer ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          address: a,
          city: c,
          phone: phone.trim(),
          quoteDate: d,
          nextMeetingDate: (nextMeetingDate || '').trim(),
          salesperson: s,
          salespersonPhone: salespersonPhone.trim(),
          payload: payloadToSave,
          subtotal: totals.subtotal,
          totalBeforeRot: totals.totalBeforeRot,
          rotAmount: totals.rotAmount,
          totalAfterRot: totals.totalAfterRot,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Kunde inte spara offert.');
      if (json?.item?.id) setActiveId(String(json.item.id));
      if (json?.item?.created_at) setActiveCreatedAt(String(json.item.created_at));
      setActiveOffertNumber(formatOffertNumber(json?.item?.offert_number_year, json?.item?.offert_number_seq) || null);
      setHasLoadedOffer(isUpdatingLoadedOffer);
      toast.success(isUpdatingLoadedOffer ? 'Offert uppdaterad.' : 'Offert sparad.', { ttl: 5000 });
      const savedAt = json?.item?.created_at ? new Date(String(json.item.created_at)) : new Date();
      setSaveNotice({ kind: 'success', message: `${isUpdatingLoadedOffer ? 'Offert uppdaterad' : 'Offert sparad'} ${savedAt.toLocaleString('sv-SE')}.` });
      if (!isUpdatingLoadedOffer) {
        setQuoteName('');
        setAddress('');
        setCity('');
        setPhone('');
        setQuoteDate(new Date().toISOString().slice(0, 10));
        setNextMeetingDate('');
        setSalesperson(profileName || '');
        setSalespersonPhone(String(profilePhone || '').trim());
        setOvrigInfo('');
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      toast.error(msg);
      setSaveNotice({ kind: 'error', message: msg });
    } finally {
      setSaving(false);
    }
  };

  const fillQuoteAddress = async () => {
    if (!('geolocation' in navigator)) {
      toast.error('Platstjänster stöds inte på den här enheten.');
      return;
    }
    setLocatingAddress(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        });
      });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const res = await fetch(`/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Kunde inte hämta adress');

      const street = String(j?.street || '').trim();
      const cityName = String(j?.city || '').trim();
      const display = String(j?.address || '').trim();

      if (street) setAddress(street);
      else if (display) setAddress(display);
      if (cityName) setCity(cityName);

      if (!street && !cityName && !display) throw new Error('Kunde inte tolka adress.');
    } catch (e: any) {
      toast.error(e?.message || 'Kunde inte hämta din plats');
    } finally {
      setLocatingAddress(false);
    }
  };

  const load = async (id: string) => {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/offert-kalkylator/${encodeURIComponent(id)}`, { method: 'GET' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Kunde inte ladda offert.');
      const item = json?.item;
      const payload = item?.payload;
      if (!payload || typeof payload !== 'object') throw new Error('Offert saknar payload.');
      const nextState = { ...OFFERT_KALKYLATOR_DEFAULT_STATE, ...payload } as OffertKalkylatorState;
      if (!nextState.isoleringHojd) nextState.isoleringHojd = OFFERT_KALKYLATOR_DEFAULT_STATE.isoleringHojd;
      if (!nextState.utsugningHojd) nextState.utsugningHojd = OFFERT_KALKYLATOR_DEFAULT_STATE.utsugningHojd;
      setState(nextState);
      const extra = (payload as any)?.ovrigInfo;
      setOvrigInfo(typeof extra === 'string' ? extra : '');
      if (typeof item?.name === 'string') setQuoteName(item.name);
      if (typeof item?.address === 'string') setAddress(item.address);
      if (typeof item?.city === 'string') setCity(item.city);
      if (typeof item?.phone === 'string') setPhone(item.phone);
      if (typeof item?.quote_date === 'string') setQuoteDate(item.quote_date);
      if (typeof item?.next_meeting_date === 'string') setNextMeetingDate(item.next_meeting_date);
      else setNextMeetingDate('');
      if (profileName) setSalesperson(profileName);
      else if (typeof item?.salesperson === 'string') setSalesperson(item.salesperson);
      if (String(profilePhone || '').trim()) setSalespersonPhone(String(profilePhone || '').trim());
      else if (typeof item?.salesperson_phone === 'string') setSalespersonPhone(item.salesperson_phone);
      else setSalespersonPhone('');
      setActiveId(String(item?.id || id));
      if (typeof item?.created_at === 'string') setActiveCreatedAt(item.created_at);
      setActiveOffertNumber(formatOffertNumber(item?.offert_number_year, item?.offert_number_seq) || null);
      setHasLoadedOffer(true);
      toast.info('Offert laddad.');
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setLoadingId(null);
    }
  };

  useEffect(() => {
    const id = (searchParams.get('load') || '').trim();
    if (!id) return;
    if (lastAutoLoadedIdRef.current === id) return;
    lastAutoLoadedIdRef.current = id;
    (async () => {
      await load(id);
      router.replace('/offert/kalkylator');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router]);

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>Offertkalkylator</h1>
          <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
            Summerar valda rader, lägger på marginal och etableringskostnad, och räknar ROT.
          </p>
        </div>
        <Link className="btn--plain btn--sm" href="/offert/kalkylator/sparade">
          Sparade offerter
        </Link>
      </div>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#ffffff', display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 13 }}>BAS</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span style={{ color: '#334155' }}>Etablering (kr)</span>
            <input
              type="number"
              min={0}
              value={String(state.etableringKr)}
              onChange={(e) => setState((s) => ({ ...s, etableringKr: toNum(e.target.value) }))}
              style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span style={{ color: '#334155' }}>Marginal (kr)</span>
            <input
              type="number"
              min={0}
              value={String(state.marginalKr)}
              onChange={(e) => setState((s) => ({ ...s, marginalKr: toNum(e.target.value) }))}
              style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
            />
          </label>
        </div>
      </section>

      {showActiveSummary && (
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#ffffff', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 13 }}>AKTIV OFFERT</strong>
            {activeCreatedAt && (
              <span style={{ fontSize: 12, color: '#64748b' }}>Laddad: {new Date(activeCreatedAt).toLocaleString('sv-SE')}</span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, fontSize: 12 }}>
            <div><span style={{ color: '#64748b' }}>Offertnummer:</span> {activeOffertNumber || '—'}</div>
            <div><span style={{ color: '#64748b' }}>Namn:</span> {quoteName.trim() || '—'}</div>
            <div><span style={{ color: '#64748b' }}>Datum:</span> {quoteDate.trim() || '—'}</div>
            <div><span style={{ color: '#64748b' }}>Adress:</span> {address.trim() || '—'}</div>
            <div><span style={{ color: '#64748b' }}>Stad:</span> {city.trim() || '—'}</div>
            <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b' }}>Nästa möte:</span> {nextMeetingDate.trim() || '—'}</div>
            {activeId && (
              <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b' }}>Vår referens:</span> {salesperson.trim() || '—'}</div>
            )}
            {activeId && (
              <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b' }}>Telefonnummer:</span> {salespersonPhone.trim() || '—'}</div>
            )}
          </div>

          <div style={{ height: 1, background: '#e5e7eb', margin: '2px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
            <div style={{ color: '#64748b' }}>Totalsumma (innan ROT)</div>
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatKr(totals.totalBeforeRot)}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
            <div style={{ color: '#64748b' }}>Totalsumma (efter ROT)</div>
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatKr(totals.totalAfterRot)}</div>
          </div>

          {activeId && (
            <>
              <div style={{ height: 1, background: '#e5e7eb', margin: '2px 0' }} />
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Kunduppgifter: {
                      customerStatus === 'submitted' ? 'Inskickat' :
                      customerStatus === 'pending' ? 'Väntar på kund' :
                      customerStatus === 'revoked' ? 'Ersatt av ny länk' :
                      'Ingen länk'
                    }
                    {customerSubmittedAt && customerStatus === 'submitted' && (
                      <span> ({new Date(customerSubmittedAt).toLocaleString('sv-SE')})</span>
                    )}
                    {customerCreatedAt && customerStatus === 'pending' && (
                      <span> ({new Date(customerCreatedAt).toLocaleString('sv-SE')})</span>
                    )}
                  </div>
                </div>

                {loadingCustomerData && (
                  <div style={{ fontSize: 12, color: '#64748b' }}>Hämtar kundstatus…</div>
                )}

                {customerResponse && (
                  <div style={{ display: 'grid', gap: 8, marginTop: 2 }}>
                    <strong style={{ fontSize: 12 }}>KUNDSVAR</strong>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, fontSize: 12 }}>
                      <div><span style={{ color: '#64748b' }}>Namn 1:</span> {customerResponse.person1_name || '—'}</div>
                      <div><span style={{ color: '#64748b' }}>Personnr 1:</span> {customerResponse.person1_personnummer || '—'}</div>
                      <div><span style={{ color: '#64748b' }}>Namn 2:</span> {customerResponse.person2_name || '—'}</div>
                      <div><span style={{ color: '#64748b' }}>Personnr 2:</span> {customerResponse.person2_personnummer || '—'}</div>
                      <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b' }}>Leveransadress:</span> {customerResponse.delivery_address || '—'}</div>
                      <div><span style={{ color: '#64748b' }}>Postnr:</span> {customerResponse.postal_code || '—'}</div>
                      <div><span style={{ color: '#64748b' }}>Ort:</span> {customerResponse.city || '—'}</div>
                      <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b' }}>Fastighetsbeteckning:</span> {customerResponse.property_designation || '—'}</div>
                      <div><span style={{ color: '#64748b' }}>Telefon:</span> {customerResponse.phone || '—'}</div>
                      <div><span style={{ color: '#64748b' }}>E-post:</span> {customerResponse.email || '—'}</div>
                      <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b' }}>Befintlig isolering:</span> {customerResponse.existing_insulation || '—'}</div>
                      <div><span style={{ color: '#64748b' }}>Vindslucka:</span> {customerResponse.attic_hatch_type || '—'}</div>
                      <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b' }}>Övrigt:</span> {customerResponse.other_info || '—'}</div>
                    </div>
                    {customerResponse.signature_data_url && (
                      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, background: '#fff' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt="Signatur" src={customerResponse.signature_data_url} style={{ width: '100%', height: 'auto', display: 'block' }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* ISOLE RING */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#ffffff', display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 13 }}>ISOLERING</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <SelectNumber
            value={state.isoleringKvm}
            onChange={(n) => setState((s) => ({ ...s, isoleringKvm: n }))}
            max={400}
            suffix="kvm"
          />
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span style={{ color: '#334155' }}>höjd cm</span>
            <select
              className="select-field"
              value={state.isoleringHojd}
              onChange={(e) => setState((s) => ({ ...s, isoleringHojd: e.target.value as IsoleringHojd }))}
            >
              <option value="25-35">25–35</option>
              <option value="45-55">45–55</option>
            </select>
          </label>
        </div>
      </section>

      {/* LANDGÅNG */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#ffffff', display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 13 }}>LANDGÅNG</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, maxWidth: 240 }}>
          <SelectNumber
            value={state.landgangM}
            onChange={(n) => setState((s) => ({ ...s, landgangM: n }))}
            max={100}
            suffix="m"
          />
        </div>
      </section>

      {/* ÖVRIGT */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#ffffff', display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 13 }}>ÖVRIGT</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <SelectNumber value={state.sargSt} onChange={(n) => setState((s) => ({ ...s, sargSt: n }))} max={20} suffix="Sarg (st)" />
          <SelectNumber
            value={state.tatningslistTakluckaSt}
            onChange={(n) => setState((s) => ({ ...s, tatningslistTakluckaSt: n }))}
            max={20}
            suffix="Tätningslist runt taklucka (st)"
          />
          <SelectNumber value={state.brandmattaSt} onChange={(n) => setState((s) => ({ ...s, brandmattaSt: n }))} max={20} suffix="Brandmatta (st)" />
          <SelectNumber
            value={state.rorIsolering30mmSt}
            onChange={(n) => setState((s) => ({ ...s, rorIsolering30mmSt: n }))}
            max={50}
            suffix="Rörisolering 30mm (st)"
          />
          <SelectNumber value={state.elverkSt} onChange={(n) => setState((s) => ({ ...s, elverkSt: n }))} max={20} suffix="Elverk (st)" />
          <SelectNumber
            value={state.takfotsTattingVindavledareSt}
            onChange={(n) => setState((s) => ({ ...s, takfotsTattingVindavledareSt: n }))}
            max={200}
            suffix="Takfots tätning/vindavledare (st)"
          />
        </div>
      </section>

      {/* MÖGELBEHANDLING */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#ffffff', display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 13 }}>MÖGELBEHANDLING</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, maxWidth: 240 }}>
          <SelectNumber
            value={state.mogelbehandlingKvm}
            onChange={(n) => setState((s) => ({ ...s, mogelbehandlingKvm: n }))}
            max={400}
            suffix="kvm"
          />
        </div>
      </section>

      {/* UTSUGNING */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#ffffff', display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 13 }}>UTSUGNING</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <SelectNumber
            value={state.utsugningKvm}
            onChange={(n) => setState((s) => ({ ...s, utsugningKvm: n }))}
            max={400}
            suffix="kvm"
          />
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <span style={{ color: '#334155' }}>höjd cm</span>
            <select
              className="select-field"
              value={state.utsugningHojd}
              onChange={(e) => setState((s) => ({ ...s, utsugningHojd: e.target.value as UtsugningHojd }))}
            >
              <option value="20">20</option>
              <option value="21-40">21–40</option>
            </select>
          </label>
        </div>
      </section>

      {/* TÄTSKIKT */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#ffffff', display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 13 }}>TÄTSKIKT</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, maxWidth: 240 }}>
          <SelectNumber value={state.tatskiktKvm} onChange={(n) => setState((s) => ({ ...s, tatskiktKvm: n }))} max={400} suffix="kvm" />
        </div>
      </section>

      {/* RESULTAT */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#f8fafc', display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 13 }}>SUMMA</strong>

        <div style={{ display: 'grid', gap: 6 }}>
          {totals.lines.length === 0 ? (
            <div style={{ fontSize: 12, color: '#64748b' }}>Välj minst en rad för att räkna.</div>
          ) : (
            totals.lines.map((l) => (
              <div key={l.key} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', fontSize: 12 }}>
                <div style={{ color: '#0f172a' }}>{l.label}</div>
                <div style={{ color: '#334155', whiteSpace: 'nowrap' }}>
                  {l.qty} {l.unit} × {formatKr(l.unitPrice)} = {formatKr(l.lineTotal)}
                </div>
              </div>
            ))
          )}

          <div style={{ height: 1, background: '#e5e7eb', margin: '6px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <div>Delsumma</div>
            <div style={{ whiteSpace: 'nowrap' }}>{formatKr(totals.subtotal)}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <div>Etableringskostnad</div>
            <div style={{ whiteSpace: 'nowrap' }}>{formatKr(totals.etablering)}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <div>Marginal</div>
            <div style={{ whiteSpace: 'nowrap' }}>{formatKr(totals.marginal)}</div>
          </div>

          <div style={{ height: 1, background: '#e5e7eb', margin: '6px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
            <div>Totalsumma (innan ROT)</div>
            <div style={{ whiteSpace: 'nowrap' }}>{formatKr(totals.totalBeforeRot)}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <div>ROT</div>
            <div style={{ whiteSpace: 'nowrap' }}>− {formatKr(totals.rotAmount)}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
            <div>Totalsumma (efter ROT)</div>
            <div style={{ whiteSpace: 'nowrap' }}>{formatKr(totals.totalAfterRot)}</div>
          </div>
        </div>
      </section>

      {/* SPARA */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#ffffff', display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 13 }}>SPARA OFFERT</strong>
        <div style={{ display: 'grid', gap: 10 }}>
          {saveNotice && (
            <div
              role="status"
              aria-live="polite"
              style={{
                fontSize: 12,
                borderRadius: 10,
                padding: '10px 12px',
                border: `1px solid ${saveNotice.kind === 'success' ? '#bbf7d0' : '#fecaca'}`,
                background: saveNotice.kind === 'success' ? '#f0fdf4' : '#fef2f2',
                color: '#0f172a',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700 }}>{saveNotice.kind === 'success' ? 'Sparat' : 'Fel'}</span>
                <span>{saveNotice.message}</span>
              </div>
              <Link className="btn--plain btn--sm" href="/offert/kalkylator/sparade">
                Visa sparade
              </Link>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <span style={{ color: '#334155' }}>Namn *</span>
              <input
                value={quoteName}
                onChange={(e) => setQuoteName(e.target.value)}
                placeholder="T.ex. Villa Andersson"
                style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <span style={{ color: '#334155' }}>Datum *</span>
              <input
                type="date"
                value={quoteDate}
                onChange={(e) => setQuoteDate(e.target.value)}
                style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <span style={{ color: '#334155' }}>Nästa inbokat möte</span>
              <input
                type="date"
                value={nextMeetingDate}
                onChange={(e) => setNextMeetingDate(e.target.value)}
                style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <span style={{ color: '#334155' }}>Adress *</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Gata 1"
                  style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
                />
                <button
                  type="button"
                  className="btn--plain btn--sm"
                  onClick={fillQuoteAddress}
                  disabled={locatingAddress}
                  title="Hämta nuvarande plats"
                >
                  {locatingAddress ? 'Hämtar…' : 'Hämta plats'}
                </button>
              </div>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <span style={{ color: '#334155' }}>Stad *</span>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Stad"
                style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <span style={{ color: '#334155' }}>Telefon</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="070-123 45 67"
                inputMode="tel"
                style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, gridColumn: '1 / -1' }}>
              <span style={{ color: '#334155' }}>Vår referens *</span>
              <input
                value={salesperson}
                onChange={(e) => setSalesperson(e.target.value)}
                placeholder="Namn på referens"
                disabled={!!profileName}
                style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 4, fontSize: 12, gridColumn: '1 / -1' }}>
              <span style={{ color: '#334155' }}>Telefonnummer</span>
              <input
                value={salespersonPhone}
                onChange={(e) => setSalespersonPhone(e.target.value)}
                placeholder="070-123 45 67"
                inputMode="tel"
                disabled={!!String(profilePhone || '').trim()}
                style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 4, fontSize: 12, gridColumn: '1 / -1' }}>
              <span style={{ color: '#334155' }}>Övrig info</span>
              <textarea
                value={ovrigInfo}
                onChange={(e) => setOvrigInfo(e.target.value)}
                placeholder="T.ex. portkod, särskilda önskemål, intern notering"
                rows={3}
                style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, resize: 'vertical' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn--success" disabled={saving || !canSave} onClick={save} style={{ minWidth: 160 }}>
              {saving ? 'Sparar…' : hasLoadedOffer && activeId ? 'Uppdatera offert' : 'Spara'}
            </button>
            <button
              className="btn--plain"
              onClick={() => {
                setState(OFFERT_KALKYLATOR_DEFAULT_STATE);
                setQuoteName('');
                setAddress('');
                setCity('');
                setPhone('');
                setQuoteDate(new Date().toISOString().slice(0, 10));
                setNextMeetingDate('');
                setSalesperson(profileName || '');
                setSalespersonPhone(String(profilePhone || '').trim());
                setOvrigInfo('');
                setActiveId(null);
                setActiveCreatedAt(null);
                setActiveOffertNumber(null);
                setHasLoadedOffer(false);
              }}
              disabled={saving}
              style={{ minWidth: 160 }}
            >
              Nollställ
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function OffertKalkylatorPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 16, maxWidth: 980, margin: '0 auto', fontSize: 12, color: '#64748b' }}>
          Laddar…
        </div>
      }
    >
      <OffertKalkylatorInner />
    </Suspense>
  );
}
