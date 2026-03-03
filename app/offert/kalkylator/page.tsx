'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import {
  computeOffertKalkylator,
  OFFERT_KALKYLATOR_DEFAULT_STATE,
  type OffertKalkylatorState,
  type IsoleringHojd,
  type UtsugningHojd,
} from '@/lib/offertKalkylator';
import { useToast } from '@/lib/Toast';
import { useUserProfile } from '@/lib/UserProfileContext';

type SavedItem = {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  quote_date: string;
  salesperson: string;
  created_at: string;
  subtotal: number;
  total_before_rot: number;
  rot_amount: number;
  total_after_rot: number;
};

function formatKr(value: number) {
  const v = Number.isFinite(value) ? value : 0;
  return `${Math.round(v).toLocaleString('sv-SE')} kr`;
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

export default function OffertKalkylatorPage() {
  const toast = useToast();
  const profile = useUserProfile();
  const profileName = (profile?.full_name || '').trim();
  const [state, setState] = useState<OffertKalkylatorState>(OFFERT_KALKYLATOR_DEFAULT_STATE);
  const [quoteName, setQuoteName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [quoteDate, setQuoteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [salesperson, setSalesperson] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeCreatedAt, setActiveCreatedAt] = useState<string | null>(null);
  const [hasLoadedOffer, setHasLoadedOffer] = useState(false);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [locatingAddress, setLocatingAddress] = useState(false);

  const totals = useMemo(() => computeOffertKalkylator(state), [state]);

  const refreshList = async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/offert-kalkylator', { method: 'GET' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Kunde inte hämta sparade offerter.');
      setItems(Array.isArray(json?.items) ? json.items : []);
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!profileName) return;
    setSalesperson(profileName);
  }, [profileName]);

  const canSave = useMemo(() => {
    return !!quoteName.trim() && !!address.trim() && !!city.trim() && !!quoteDate.trim() && !!salesperson.trim();
  }, [quoteName, address, city, quoteDate, salesperson]);

  type SortMode =
    | 'created_desc'
    | 'created_asc'
    | 'quote_date_desc'
    | 'quote_date_asc'
    | 'name_asc'
    | 'name_desc'
    | 'total_after_rot_desc'
    | 'total_after_rot_asc';

  const [sortMode, setSortMode] = useState<SortMode>('created_desc');

  const sortedItems = useMemo(() => {
    const arr = [...items];
    const byCreatedDesc = (a: SavedItem, b: SavedItem) => String(b.created_at).localeCompare(String(a.created_at));

    arr.sort((a, b) => {
      switch (sortMode) {
        case 'created_desc':
          return byCreatedDesc(a, b);
        case 'created_asc':
          return String(a.created_at).localeCompare(String(b.created_at));
        case 'quote_date_desc':
          return String(b.quote_date).localeCompare(String(a.quote_date)) || byCreatedDesc(a, b);
        case 'quote_date_asc':
          return String(a.quote_date).localeCompare(String(b.quote_date)) || byCreatedDesc(a, b);
        case 'name_asc':
          return String(a.name).localeCompare(String(b.name), 'sv', { sensitivity: 'base' }) || byCreatedDesc(a, b);
        case 'name_desc':
          return String(b.name).localeCompare(String(a.name), 'sv', { sensitivity: 'base' }) || byCreatedDesc(a, b);
        case 'total_after_rot_desc':
          return (Number(b.total_after_rot) - Number(a.total_after_rot)) || byCreatedDesc(a, b);
        case 'total_after_rot_asc':
          return (Number(a.total_after_rot) - Number(b.total_after_rot)) || byCreatedDesc(a, b);
        default:
          return byCreatedDesc(a, b);
      }
    });

    return arr;
  }, [items, sortMode]);

  const showActiveSummary = useMemo(() => {
    return hasLoadedOffer;
  }, [hasLoadedOffer]);

  const save = async () => {
    const name = quoteName.trim();
    const a = address.trim();
    const c = city.trim();
    const d = quoteDate.trim();
    const s = salesperson.trim();
    if (!name) return toast.error('Namn är obligatoriskt.');
    if (!a) return toast.error('Adress är obligatoriskt.');
    if (!c) return toast.error('Stad är obligatoriskt.');
    if (!d) return toast.error('Datum är obligatoriskt.');
    if (!s) return toast.error('Säljare är obligatoriskt.');

    setSaving(true);
    try {
      const res = await fetch('/api/offert-kalkylator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          address: a,
          city: c,
          phone: phone.trim(),
          quoteDate: d,
          salesperson: s,
          payload: state,
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
      setHasLoadedOffer(false);
      toast.success('Offert sparad.');
      setQuoteName('');
      setAddress('');
      setCity('');
      setPhone('');
      setQuoteDate(new Date().toISOString().slice(0, 10));
      setSalesperson(profileName || '');
      await refreshList();
    } catch (e: any) {
      toast.error(e?.message || String(e));
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
      setState({ ...OFFERT_KALKYLATOR_DEFAULT_STATE, ...payload });
      if (typeof item?.name === 'string') setQuoteName(item.name);
      if (typeof item?.address === 'string') setAddress(item.address);
      if (typeof item?.city === 'string') setCity(item.city);
      if (typeof item?.phone === 'string') setPhone(item.phone);
      if (typeof item?.quote_date === 'string') setQuoteDate(item.quote_date);
      if (profileName) setSalesperson(profileName);
      else if (typeof item?.salesperson === 'string') setSalesperson(item.salesperson);
      setActiveId(String(item?.id || id));
      if (typeof item?.created_at === 'string') setActiveCreatedAt(item.created_at);
      setHasLoadedOffer(true);
      toast.info('Offert laddad.');
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setLoadingId(null);
    }
  };

  const del = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/offert-kalkylator/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Kunde inte ta bort offert.');
      toast.success('Offert borttagen.');
      if (activeId === id) {
        setActiveId(null);
        setActiveCreatedAt(null);
        setHasLoadedOffer(false);
      }
      await refreshList();
    } catch (e: any) {
      toast.error(e?.message || String(e));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: '0 auto', display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Offertkalkylator</h1>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
          Summerar valda rader, lägger på marginal och etableringskostnad, och räknar ROT.
        </p>
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
            <div><span style={{ color: '#64748b' }}>Namn:</span> {quoteName.trim() || '—'}</div>
            <div><span style={{ color: '#64748b' }}>Datum:</span> {quoteDate.trim() || '—'}</div>
            <div><span style={{ color: '#64748b' }}>Adress:</span> {address.trim() || '—'}</div>
            <div><span style={{ color: '#64748b' }}>Stad:</span> {city.trim() || '—'}</div>
            {activeId && (
              <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b' }}>Säljare:</span> {salesperson.trim() || '—'}</div>
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
              <option value="">Välj…</option>
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
              <option value="">Välj…</option>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
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
              <span style={{ color: '#334155' }}>Säljare *</span>
              <input
                value={salesperson}
                onChange={(e) => setSalesperson(e.target.value)}
                placeholder="Namn på säljare"
                disabled={!!profileName}
                style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn--success" disabled={saving || !canSave} onClick={save} style={{ minWidth: 160 }}>
              {saving ? 'Sparar…' : 'Spara'}
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
                setSalesperson(profileName || '');
                setActiveId(null);
                setActiveCreatedAt(null);
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

      {/* LISTA */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#ffffff', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13 }}>SPARADE OFFERTER</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
              <span>Sortera</span>
              <select
                className="select-field"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
              >
                <option value="created_desc">Senast sparad</option>
                <option value="created_asc">Äldst sparad</option>
                <option value="quote_date_desc">Offertdatum (nyast)</option>
                <option value="quote_date_asc">Offertdatum (äldst)</option>
                <option value="name_asc">Namn (A–Ö)</option>
                <option value="name_desc">Namn (Ö–A)</option>
                <option value="total_after_rot_desc">Efter ROT (högst)</option>
                <option value="total_after_rot_asc">Efter ROT (lägst)</option>
              </select>
            </label>
            <button className="btn--plain btn--sm" onClick={refreshList} disabled={loadingList}>
              {loadingList ? 'Uppdaterar…' : 'Uppdatera'}
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b' }}>Inga sparade offerter ännu.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {sortedItems.map((it) => (
              <div
                key={it.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                  padding: 10,
                  display: 'grid',
                  gap: 8,
                  background: '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'grid', gap: 2 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{it.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {it.address} • {it.city} • {it.quote_date} • {it.salesperson}
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{new Date(it.created_at).toLocaleString('sv-SE')}</div>
                  </div>
                  <div style={{ display: 'grid', gap: 2, textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: '#334155' }}>Efter ROT</div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{formatKr(it.total_after_rot)}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn--primary btn--sm"
                    onClick={() => load(it.id)}
                    disabled={loadingId === it.id || deletingId === it.id}
                  >
                    {loadingId === it.id ? 'Laddar…' : 'Ladda'}
                  </button>
                  <button
                    className="btn--danger btn--sm"
                    onClick={() => del(it.id)}
                    disabled={deletingId === it.id || loadingId === it.id}
                  >
                    {deletingId === it.id ? 'Tar bort…' : 'Ta bort'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
