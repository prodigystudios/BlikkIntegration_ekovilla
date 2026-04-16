"use client";

import React, { useState } from 'react';

export default function AdminNews() {
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const h = headline.trim();
    const b = body.trim();
    if (!h || !b) return;
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/admin/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline: h, body: b, imageUrl: imageUrl.trim() || null })
      });
      if (!res.ok) {
        let msg = 'Kunde inte spara nyheten.';
        try {
          const j = await res.json();
          if (j?.error) msg = String(j.error);
        } catch {}
        setError(msg);
        setStatus('error');
        return;
      }
      setHeadline('');
      setBody('');
      setImageUrl('');
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1200);
    } catch (e: any) {
      setError(String(e?.message || 'Okänt fel'));
      setStatus('error');
    }
  }

  return (
    <main style={{ padding: 12, display: 'grid', gap: 20, maxWidth: 1100, margin: '0 auto' }}>
      <section style={{ border: '1px solid #dbe4ef', background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)', borderRadius: 24, padding: 20, display: 'grid', gap: 16, boxShadow:'0 14px 36px rgba(15,23,42,0.04)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', alignItems:'flex-start' }}>
          <div style={{ display:'grid', gap:6, maxWidth:700 }}>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <span style={eyebrowStyle}>Nyheter</span>
              <span style={chipStyle}>{headline.trim().length} tecken i rubrik</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 30, color:'#0f172a' }}>Publicera dashboardnyheter med bättre kontroll</h1>
            <p style={{ margin:0, fontSize:14, color:'#475569', lineHeight:1.55 }}>Skriv nyheten, förhandsgranska hur den läses och publicera när innehållet känns klart.</p>
          </div>
          <div style={miniStatStyle}>
            <span style={miniLabelStyle}>Status</span>
            <strong style={miniValueStyle}>{status === 'saved' ? 'Sparad' : status === 'saving' ? 'Sparar…' : 'Redigeras'}</strong>
          </div>
        </div>
      </section>

      <section style={{ display:'grid', gap:20, gridTemplateColumns:'minmax(0, 1.1fr) minmax(320px, 0.9fr)' }}>
      <section style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 20, padding: 20, display: 'grid', gap: 14, boxShadow:'0 10px 28px rgba(15,23,42,0.03)' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Skapa ny nyhet</h2>
        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <label style={labelStyle}>
            Rubrik
            <input
              required
              value={headline}
              onChange={e => setHeadline(e.target.value)}
              placeholder="t.ex. Ny uppdatering i planeringen"
              style={fieldStyle}
            />
          </label>

          <label style={labelStyle}>
            Text
            <textarea
              required
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Skriv en kort beskrivning…"
              rows={6}
              style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.35 }}
            />
          </label>

          <label style={labelStyle}>
            Bild-URL (valfritt)
            <input
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              placeholder="https://…"
              style={fieldStyle}
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="submit"
              disabled={status === 'saving' || headline.trim().length === 0 || body.trim().length === 0}
              style={{ ...buttonStyle, opacity: status === 'saving' ? 0.7 : 1 }}
            >
              {status === 'saving' ? 'Sparar…' : (status === 'saved' ? 'Sparat ✓' : 'Publicera nyhet')}
            </button>
            {error && <span style={{ color: '#b91c1c', fontSize: 13 }}>{error}</span>}
          </div>
        </form>

        <div style={{ fontSize: 12, color: '#6b7280' }}>
          Nyheten visas som en modal på dashboarden en gång per nyhet (per webbläsare) via localStorage.
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 20, padding: 20, display: 'grid', gap: 14, alignContent:'start', boxShadow:'0 10px 28px rgba(15,23,42,0.03)' }}>
        <h2 style={{ margin:0, fontSize:18 }}>Förhandsvisning</h2>
        <div style={{ border:'1px solid #dbe4ef', borderRadius:20, padding:16, background:'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)', display:'grid', gap:12 }}>
          {imageUrl.trim() ? (
            <div style={{ width:'100%', aspectRatio:'16 / 9', borderRadius:16, backgroundImage:`url(${imageUrl.trim()})`, backgroundSize:'cover', backgroundPosition:'center', border:'1px solid #dbe4ef' }} />
          ) : (
            <div style={{ width:'100%', aspectRatio:'16 / 9', borderRadius:16, border:'1px dashed #cbd5e1', display:'grid', placeItems:'center', color:'#94a3b8', fontSize:13 }}>Ingen bild vald</div>
          )}
          <div style={{ display:'grid', gap:8 }}>
            <strong style={{ fontSize:22, lineHeight:1.15, color:'#0f172a' }}>{headline.trim() || 'Rubriken visas här'}</strong>
            <p style={{ margin:0, fontSize:14, lineHeight:1.6, color:'#475569', whiteSpace:'pre-wrap' }}>{body.trim() || 'Brödtexten visas här när du börjar skriva nyheten.'}</p>
          </div>
        </div>
      </section>
      </section>
    </main>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  display: 'grid',
  gap: 6
};

const fieldStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 10,
  fontSize: 14,
  outline: 'none'
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  fontSize: 14,
  border: '1px solid #111827',
  background: '#111827',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer'
};

const eyebrowStyle: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 10px', borderRadius:999, background:'#dbeafe', border:'1px solid #bfdbfe', color:'#2563eb', fontSize:11, fontWeight:800, letterSpacing:0.35, textTransform:'uppercase' };
const chipStyle: React.CSSProperties = { display:'inline-flex', alignItems:'center', padding:'4px 8px', borderRadius:999, background:'#f8fafc', border:'1px solid #e2e8f0', color:'#475569', fontSize:12, fontWeight:700 };
const miniStatStyle: React.CSSProperties = { display:'grid', gap:5, padding:'12px 12px 10px', borderRadius:16, border:'1px solid #dbe4ef', background:'#fff', minWidth:160 };
const miniLabelStyle: React.CSSProperties = { fontSize:11, fontWeight:800, letterSpacing:0.3, textTransform:'uppercase', color:'#64748b' };
const miniValueStyle: React.CSSProperties = { fontSize:20, fontWeight:800, color:'#0f172a' };
