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
    <main style={{ padding: 32, maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h1 style={{ margin: 0, fontSize: 30 }}>Admin • Nyheter</h1>

      <section style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 16, padding: 24, display: 'grid', gap: 14 }}>
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
