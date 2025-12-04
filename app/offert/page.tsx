'use client';
export const dynamic = 'force-dynamic';
import {useEffect, useMemo, useState } from 'react';

type OffertType = 'private' | 'business';
type LineItem = {
  id: string; // local uid
  construction: 'vagg' | 'snedtak' | 'vind' | '';
  m2: string;
  thicknessMm: string;
  autoPrice: boolean;
  unitPrice: string;
  // pricing mode: insulation areas are priced per m3, articles like tape per item
  pricing?: 'm3' | 'item';
  quantity?: string; // used when pricing === 'item'
  articleId?: string | null;
  articleName?: string | null;
  articleNumber?: string | null;
  articlePrice?: number | null;
  articleUnitName?: string | null;
  discountPercent?: string; // % discount applied to unit price (0-100)
};

type QuoteForm = {
  type: OffertType;
  customerName: string;
  personalNumber?: string;
  companyName: string;
  email: string;
  phone: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  visitAddress?: string;
  deliveryAddress?: string;
  invoiceAddress?: string;
  items: LineItem[];
  vatPercent: string; // string input, e.g. 25
  validUntil: string; // date ISO
  notes: string;
};

export default function OffertPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<QuoteForm | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openFor = (type: OffertType) => {
    setForm({
      type,
      customerName: '',
      personalNumber: '',
      companyName: '',
      email: '',
      phone: '',
      streetAddress: '',
      postalCode: '',
      city: '',
      visitAddress: '',
      deliveryAddress: '',
      invoiceAddress: '',
      items: [
        { id: crypto.randomUUID(), construction: '', m2: '', thicknessMm: '', autoPrice: true, unitPrice: '', pricing: 'm3', quantity: '', articleId: null, articleName: null, articleNumber: null, articlePrice: null, discountPercent: '' },
      ],
      vatPercent: '25',
      validUntil: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
      notes: '',
    });
    setIsOpen(true);
  };

  const inferConstructionFromArticle = (name?: string) => {
    const s = (name || '').toLowerCase();
    if (/sned\s*tak|snedtak|taklut|lutande/.test(s)) return 'snedtak';
    if (/\bvind\b|vinds?bjälklag|vinden/.test(s)) return 'vind';
    if (/vägg|vagg|regel|stomme|väggreg/.test(s)) return 'vagg';
    return '' as const;
  };

  // Pricing model (auto): insulation areas are priced per m3.
  // Base price per m3 currently 900 SEK (thickness affects volume, not unit rate).
  const computeUnitPrice = (_construction: string, _thicknessMm: number) => {
    return 900; // SEK per m3
  };

  // Auto-update unit price when construction/thickness changes and autoPrice is enabled
  const effectiveRows = useMemo(() => {
    if (!form) return [] as Array<{ id: string; amount: number; unit: number; effectiveUnit: number; label: string; mode: 'm3' | 'item' }>;
    return form.items.map((it) => {
      const unit = it.autoPrice
        ? computeUnitPrice(it.construction, parseFloat(it.thicknessMm || '0') || 0)
        : (parseFloat(it.unitPrice || '0') || 0);

      const mode: 'm3' | 'item' = it.pricing === 'item' ? 'item' : 'm3';
      const m2 = parseFloat(it.m2 || '0') || 0;
      const thicknessM = (parseFloat(it.thicknessMm || '0') || 0) / 1000; // mm -> m
      const volume = Math.max(0, m2 * thicknessM); // m3
      const qty = parseFloat(it.quantity || '0') || 0;
      const amount = mode === 'm3' ? volume : qty;
      const rawPct = parseFloat(it.discountPercent || '0');
      const pct = isNaN(rawPct) ? 0 : Math.min(100, Math.max(0, rawPct));
      const effectiveUnit = Math.max(0, unit * (1 - pct / 100));

      const consLabel = it.construction === 'vagg' ? 'Vägg' : it.construction === 'snedtak' ? 'Snedtak' : it.construction === 'vind' ? 'Vind' : '';
      const baseLabel = it.articleName ? `${it.articleName}${it.articleNumber ? ` (${it.articleNumber})` : ''}` : `${consLabel || 'Okänd'}${it.thicknessMm ? ` ${it.thicknessMm} mm` : ''}`;
      const unitSuffix = mode === 'm3' ? ' (m³)' : (it.articleUnitName ? ` (${it.articleUnitName})` : '');
      const label = `${baseLabel}${unitSuffix}`;

      return { id: it.id, amount, unit, effectiveUnit, label, mode };
    });
  }, [form?.items]);

    const totals = useMemo(() => {
    const subtotal = Math.max(0, effectiveRows.reduce((sum, r) => sum + r.amount * r.effectiveUnit, 0));
    const vatPct = parseFloat(form?.vatPercent || '0') || 0;
    const vat = Math.max(0, subtotal * (vatPct / 100));
    const total = subtotal + vat;
      return { subtotal, vat, total };
  }, [effectiveRows, form?.vatPercent]);

  const submit = async () => {
    if (!form) return;
    setError(null);
    // Minimal validation
    if (form.type === 'private' && !form.customerName.trim()) {
      setError('Ange namn.');
      return;
    }
    if (form.type === 'private' && !(form.personalNumber || '').trim()) {
      setError('Ange personnummer.');
      return;
    }
    if (form.type === 'business' && !form.companyName.trim()) {
      setError('Ange företagsnamn.');
      return;
    }
    if (!form.items.length) { setError('Lägg till minst en rad.'); return; }
    for (const it of effectiveRows) {
      if (!(it.amount > 0) || !(it.effectiveUnit >= 0)) {
        setError('Fyll i kvantitet/volym och pris (>= 0) för varje rad.');
        return;
      }
    }

    setSubmitting(true);
    try {
  const lineItems = effectiveRows.map((r) => ({ description: r.label, quantity: r.amount, unitPrice: r.effectiveUnit }));
      const res = await fetch('/api/pdf/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          lineItems,
          vatPercent: parseFloat(form.vatPercent || '0') || 0,
          totals,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Kunde inte skapa offert.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setIsOpen(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: '80vh' }}>
      <h1 style={{ margin: 0, fontSize: 18 }}>Skapa offert</h1>
      <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Välj kundtyp för att starta.</p>
      <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          style={{ width: 220, height: 50, borderRadius: 10, border: '1px solid #e2e8f0', background: '#219e5dff', fontWeight: 600,}}
          onMouseEnter={(e) => e.currentTarget.style.background = '#1f8a4aff'}
          onMouseLeave={(e) => e.currentTarget.style.background = '#219e5dff'}
          onClick={() => openFor('private')}
        >Privat person</button>
        <button
          style={{ width: 220, height: 50, borderRadius: 10, border: '1px solid #e2e8f0', background: '#0c9c13ff', fontWeight: 600 }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#0b7e10ff'}
          onMouseLeave={(e) => e.currentTarget.style.background = '#0c9c13ff'}
          onClick={() => openFor('business')}
        >Företag</button>
      </div>

      {isOpen && form && (
        <div
          onClick={() => setIsOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, marginTop:20, zIndex: 300, minHeight: '100vh' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(1000px, 96vw)', maxHeight: '90vh', overflow: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 20px 40px rgba(0,0,0,0.25)', padding: 16, display: 'grid', gap: 12 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <strong style={{ fontSize: 16 }}>Ny offert • {form.type === 'private' ? 'Privat' : 'Företag'}</strong>
                <span style={{ fontSize: 12, color: '#64748b' }}>Fyll i kunduppgifter och offertdetaljer.</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="btn--danger btn--sm" style={{ borderRadius: 6, padding: '6px 10px', fontSize: 12, border: '1px solid #fecaca' }}>Stäng</button>
            </div>

            {error && <div style={{ fontSize: 12, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', padding: '6px 8px', borderRadius: 8 }}>{error}</div>}

            {/* Kunduppgifter */}
            <div style={{ display: 'grid', gap: 10, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#f8fafc' }}>
              <strong style={{ fontSize: 13 }}>Kund</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                {form.type === 'private' ? (
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    <span>Namn</span>
                    <input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Fullständigt namn" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                  </label>
                ) : (
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    <span>Företagsnamn</span>
                    <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Bolag AB" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                  </label>
                )}
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <span>E-post</span>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="namn@example.com" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <span>Telefon</span>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="070…" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                </label>
                {form.type === 'private' && (
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    <span>Personnummer</span>
                    <input value={form.personalNumber || ''} onChange={(e) => setForm({ ...form, personalNumber: e.target.value })} placeholder="ÅÅÅÅMMDD-XXXX" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                  </label>
                )}
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <span>Adress</span>
                  <input value={form.streetAddress} onChange={(e) => setForm({ ...form, streetAddress: e.target.value })} placeholder="Gata 1" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <span>Postnummer</span>
                  <input value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} placeholder="123 45" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <span>Ort</span>
                  <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Stad" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                </label>
                {form.type === 'private' && (
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    <span>Besöksadress</span>
                    <input value={form.visitAddress || ''} onChange={(e) => setForm({ ...form, visitAddress: e.target.value })} placeholder="Besöksadress" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                  </label>
                )}
                {form.type === 'private' && (
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    <span>Leveransadress</span>
                    <input value={form.deliveryAddress || ''} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} placeholder="Leveransadress" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                  </label>
                )}
                {form.type === 'private' && (
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    <span>Fakturaadress</span>
                    <input value={form.invoiceAddress || ''} onChange={(e) => setForm({ ...form, invoiceAddress: e.target.value })} placeholder="Fakturaadress" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                  </label>
                )}
              </div>
            </div>

            {/* Offertdetaljer */}
            <div style={{ display: 'grid', gap: 10, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
              <strong style={{ fontSize: 13 }}>Offert</strong>
              <div style={{ display: 'grid', gap: 8 }}>
                {form.items.map((row, idx) => {
                  const unit = row.autoPrice ? computeUnitPrice(row.construction, parseFloat(row.thicknessMm || '0') || 0) : (parseFloat(row.unitPrice || '0') || 0);
                  const isM3 = (row.pricing ?? 'm3') === 'm3';
                  return (
                    <div key={row.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 2fr) 1fr 1fr 2fr auto', gap: 8, alignItems: 'end' }}>
                      <div style={{ display: 'grid', gap: 6 }}>
                        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          <span>Artikel</span>
                          <ArticlePicker
                            value={row.articleName || ''}
                            onSelect={(art) => {
                              const cons = inferConstructionFromArticle(art.name);
                              const unitName = (art.unit && (art.unit.name || art.unit.objectiveName)) ? String(art.unit.name || art.unit.objectiveName) : '';
                              const u = unitName.trim().toLowerCase();
                              const isM3 = u === 'm3' || u === 'm³' || /m\s*\u00B3/i.test(u);
                              const isPerItem = u === 'rle' || u === 'st' || u === 'stk' || u === 'st.';
                              const pricingMode: 'm3' | 'item' = isM3 ? 'm3' : isPerItem ? 'item' : 'item';
                              setForm({
                                ...form,
                                items: form.items.map((x) => x.id === row.id ? {
                                  ...x,
                                  articleId: art.id || null,
                                  articleName: art.name || null,
                                  articleNumber: art.articleNumber || null,
                                  articlePrice: typeof art.price === 'number' ? art.price : null,
                                  autoPrice: false,
                                  unitPrice: String(art.price ?? ''),
                                  construction: cons || x.construction,
                                  pricing: pricingMode,
                                  quantity: pricingMode === 'item' ? (x.quantity && parseFloat(x.quantity) > 0 ? x.quantity : '1') : x.quantity,
                                  articleUnitName: unitName || null,
                                } : x)
                              });
                            }}
                            onClear={() => setForm({
                              ...form,
                              items: form.items.map((x) => x.id === row.id ? {
                                ...x,
                                articleId: null,
                                articleName: null,
                                articleNumber: null,
                                articlePrice: null,
                                articleUnitName: null,
                              } : x)
                            })}
                          />
                        </label>
                      </div>
                      {/* Column 2: Area (m²) or Quantity */}
                      {isM3 ? (
                        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          <span>m²</span>
                          <input type="number" min={0} value={row.m2} onChange={(e) => setForm({ ...form, items: form.items.map((x) => x.id === row.id ? { ...x, m2: e.target.value } : x) })} placeholder="0" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                        </label>
                      ) : (
                        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          <span>Antal</span>
                          <input type="number" min={0} value={row.quantity || ''} onChange={(e) => setForm({ ...form, items: form.items.map((x) => x.id === row.id ? { ...x, quantity: e.target.value } : x) })} placeholder="1" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                        </label>
                      )}

                      {/* Column 3: Thickness (mm) or placeholder */}
                      {isM3 ? (
                        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                          <span>Tjocklek (mm)</span>
                          <input type="number" min={0} value={row.thicknessMm} onChange={(e) => setForm({ ...form, items: form.items.map((x) => x.id === row.id ? { ...x, thicknessMm: e.target.value } : x) })} placeholder="200" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                        </label>
                      ) : (
                        <div />
                      )}
                      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,1fr) auto minmax(90px, 0.7fr)', alignItems: 'end', columnGap: 8 }}>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <span>À-pris (SEK)</span>
                            <input type="number" min={0} value={row.autoPrice ? String(unit || 0) : row.unitPrice} onChange={(e) => setForm({ ...form, items: form.items.map((x) => x.id === row.id ? { ...x, unitPrice: e.target.value } : x) })} disabled={row.autoPrice} placeholder="0" style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: row.autoPrice ? '#f8fafc' : '#fff' }} />
                          </div>
                          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }} title="Justera pris manuellt">
                            <input type="checkbox" checked={!row.autoPrice} onChange={(e) => setForm({ ...form, items: form.items.map((x) => x.id === row.id ? { ...x, autoPrice: !e.target.checked } : x) })} />
                            <span>Manuellt</span>
                          </label>
                          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                            <span>Rabatt %</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={row.discountPercent || ''}
                              onChange={(e) => setForm({
                                ...form,
                                items: form.items.map((x) => x.id === row.id ? { ...x, discountPercent: e.target.value } : x)
                              })}
                              placeholder="0"
                              style={{ width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }}
                            />
                          </label>
                        </div>
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className='btn--sm btn--danger' onClick={() => setForm({ ...form, items: form.items.filter((x) => x.id !== row.id) })} style={{ }}>Ta bort</button>
                      </div>
                    </div>
                  );
                })}
                <div>
                  <button type="button" className='btn--sm btn--primary' onClick={() => setForm({ ...form, items: [...form.items, { id: crypto.randomUUID(), construction: '', m2: '', thicknessMm: '', autoPrice: true, unitPrice: '', pricing: 'm3', quantity: '' }] })} style={{ }}>+ Lägg till rad</button>
                </div>
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <span>Moms %</span>
                  <input type="number" min={0} value={form.vatPercent} onChange={(e) => setForm({ ...form, vatPercent: e.target.value })} placeholder="25" style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <span>Giltig t.o.m.</span>
                  <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
                </label>
              </div>

              <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                <span>Anteckningar</span>
                <textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Villkor, leverans, mm." style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
              </label>

              {/* Totals */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#334155' }}>Delsumma: <strong>{totals.subtotal.toFixed(2)} kr</strong></span>
                <span style={{ fontSize: 12, color: '#334155' }}>Moms: <strong>{totals.vat.toFixed(2)} kr</strong></span>
                <span style={{ fontSize: 13, color: '#0f172a' }}>Totalt: <strong>{totals.total.toFixed(2)} kr</strong></span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setIsOpen(false)} className="btn--plain btn--sm" style={{ borderRadius: 8, padding: '8px 12px', border: '1px solid #e2e8f0', background: '#fff' }}>Avbryt</button>
              <button onClick={submit} disabled={submitting} className="btn--plain btn--sm" style={{ borderRadius: 8, padding: '8px 12px', border: '1px solid #16a34a', background: '#16a34a', color: '#fff' }}>{submitting ? 'Skapar…' : 'Skapa offert (PDF)'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type ArticleLite = { id?: string; name?: string; articleNumber?: string; price?: number , unit: {objectiveName?:string,id?:string,name?:string}};
function ArticlePicker({ value, onSelect, onClear }: { value: string; onSelect: (a: ArticleLite) => void; onClear: () => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ArticleLite[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) { setItems([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/blikk/articles?q=${encodeURIComponent(q)}&page=1&pageSize=10`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || res.statusText);
        if (!cancelled) setItems(Array.isArray(json.items) ? json.items : []);
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || String(e)); setItems([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [q, open]);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className='input-offert-text'
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={value || 'Sök artikel…'}
          title={value || ''}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, minWidth: 100, fontSize: 12}}
        />
      </div>
      {open && (q.trim().length >= 2) && (
        <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, marginTop: 6, maxHeight: 220, overflow: 'auto', boxShadow: '0 6px 20px rgba(0,0,0,0.1)'}}>
          {loading && <div style={{ padding: 10, fontSize: 12, color: '#64748b' }}>Söker…</div>}
          {error && <div style={{ padding: 10, fontSize: 12, color: '#991b1b' }}>Fel: {error}</div>}
          {!loading && !error && items.length === 0 && <div style={{ padding: 10, fontSize: 12, color: '#64748b' }}>Inga artiklar.</div>}
          {!loading && !error && items.map((it) => (
            <button
              type="button"
              key={(it.id || it.articleNumber || Math.random().toString())}
              onClick={() => { onSelect(it); setOpen(false); setQ(''); }}
              style={{textAlign: 'left', padding: 10, border: 'none', background: '#fff', cursor: 'pointer', display: 'grid', gap: 2 }}
            >
              <span style={{ fontSize: 12, color: '#0f172a' }}>{it.name || '-'}</span>
              <span style={{ fontSize: 11, color: '#0f172a' }}>{it.articleNumber || ''} {typeof it.price === 'number' ? `• ${it.price.toFixed(2)} kr` : ''}</span>
              <span style={{ fontSize: 10, color: '#0f172a' }}>{it.unit.name || ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}