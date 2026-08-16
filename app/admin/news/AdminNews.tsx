"use client";

import React, { useState } from 'react';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import { crm } from '../../crm/lib/crmTokens';
import { cn } from '../../../lib/shared/cn';
import { ADMIN_CARD, ADMIN_ERROR_BOX, ADMIN_INSET, AdminField } from '../components/adminUi';

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
    <div className="grid gap-4 p-5">
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-bold text-slate-900">Nyheter</h2>
        <p className="m-0 text-sm text-slate-600">Nyheten visas en gång per nyhet och webbläsare som modal på dashboarden.</p>
      </div>

      <section className="grid items-start gap-4 xl:[grid-template-columns:minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <section className={cn(ADMIN_CARD, 'grid gap-3 p-4')}>
          <h3 className="m-0 text-base font-bold text-slate-900">Skapa ny nyhet</h3>
          <form onSubmit={submit} className="grid gap-3">
            <AdminField label="Rubrik">
              <Input
                required
                value={headline}
                onChange={e => setHeadline(e.target.value)}
                placeholder="t.ex. Ny uppdatering i planeringen"
              />
            </AdminField>

            <AdminField label="Text">
              <Textarea
                required
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Skriv en kort beskrivning…"
                rows={6}
                className="min-h-[144px]"
              />
            </AdminField>

            <AdminField label="Bild-URL (valfritt)">
              <Input
                value={imageUrl}
                onChange={e => setImageUrl(e.target.value)}
                placeholder="https://…"
              />
            </AdminField>

            <button
              type="submit"
              disabled={status === 'saving' || !headline.trim() || !body.trim()}
              className={cn(crm.formButton, 'justify-self-start')}
              style={{ backgroundColor: 'var(--crm-primary, #1a3f26)' }}
            >
              {status === 'saving' ? 'Sparar…' : (status === 'saved' ? 'Sparat ✓' : 'Publicera nyhet')}
            </button>
            {error && <div role="alert" className={ADMIN_ERROR_BOX}>{error}</div>}
          </form>
        </section>

        <section className={cn(ADMIN_CARD, 'grid content-start gap-3 p-4')}>
          <h3 className="m-0 text-base font-bold text-slate-900">Förhandsvisning</h3>
          <div className={cn(ADMIN_INSET, 'grid gap-3 p-4')}>
            {imageUrl.trim() ? (
              <div
                className="aspect-video w-full rounded-2xl border border-[#e0e8dc] bg-cover bg-center"
                style={{ backgroundImage: `url(${imageUrl.trim()})` }}
              />
            ) : (
              <div className="grid aspect-video w-full place-items-center rounded-2xl border border-dashed border-slate-300 text-[13px] text-slate-400">Ingen bild vald</div>
            )}
            <div className="grid gap-2">
              <strong className="text-lg font-bold leading-[1.2] text-slate-900">{headline.trim() || 'Rubriken visas här'}</strong>
              <p className="m-0 whitespace-pre-wrap text-sm leading-[1.6] text-slate-600">{body.trim() || 'Brödtexten visas här när du börjar skriva nyheten.'}</p>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
