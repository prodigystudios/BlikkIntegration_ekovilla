"use client";

import React, { useState } from 'react';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import PageShell from '../../../components/ui/PageShell';
import Textarea from '../../../components/ui/Textarea';

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

  const headlineLength = headline.trim().length;
  const bodyLength = body.trim().length;
  const statusLabel = status === 'saved' ? 'Sparad' : status === 'saving' ? 'Sparar…' : status === 'error' ? 'Fel' : 'Redigeras';

  return (
    <PageShell className="max-w-[1240px] gap-5 px-3 py-3 sm:px-4 lg:px-5">
      <section className="grid gap-4 rounded-[24px] border border-ui-border bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 shadow-[0_14px_36px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid max-w-[700px] gap-1.5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="accent" className="px-2.5 py-1 text-[11px] uppercase tracking-[0.35px]">Nyheter</Badge>
              <Badge>{headlineLength} tecken i rubrik</Badge>
              <Badge>{bodyLength} tecken i text</Badge>
            </div>
            <h1 className="m-0 text-[30px] text-slate-900">Publicera dashboardnyheter med bättre kontroll</h1>
            <p className="m-0 text-sm leading-[1.55] text-slate-600">Skriv nyheten, förhandsgranska hur den läses och publicera när innehållet känns klart.</p>
          </div>
          <div className="grid min-w-[160px] gap-1 rounded-2xl border border-ui-border bg-white px-3 py-2.5">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.3px] text-slate-500">Status</span>
            <strong className="text-xl font-extrabold text-slate-900">{statusLabel}</strong>
          </div>
        </div>
      </section>

      <section className="grid items-start gap-5 xl:[grid-template-columns:minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <section className="grid gap-4 rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.03)]">
          <h2 className="m-0 text-lg text-slate-900">Skapa ny nyhet</h2>
          <form onSubmit={submit} className="grid gap-3">
            <Field label="Rubrik">
              <Input
                required
                value={headline}
                onChange={e => setHeadline(e.target.value)}
                placeholder="t.ex. Ny uppdatering i planeringen"
              />
            </Field>

            <Field label="Text">
              <Textarea
                required
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Skriv en kort beskrivning…"
                rows={6}
                className="min-h-[144px]"
              />
            </Field>

            <Field label="Bild-URL (valfritt)">
              <Input
                value={imageUrl}
                onChange={e => setImageUrl(e.target.value)}
                placeholder="https://…"
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                type="submit"
                disabled={status === 'saving' || headlineLength === 0 || bodyLength === 0}
                variant="primary"
              >
                {status === 'saving' ? 'Sparar…' : (status === 'saved' ? 'Sparat ✓' : 'Publicera nyhet')}
              </Button>
              {error && <span className="text-sm text-red-700">{error}</span>}
            </div>
          </form>

          <div className="text-xs text-slate-500">
            Nyheten visas som en modal på dashboarden en gång per nyhet per webbläsare via localStorage.
          </div>

          <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
            <strong className="text-[13px] text-slate-900">Snabb check innan publicering</strong>
            <span className="text-xs text-slate-500">Håll rubriken kort, skriv ett tydligt syfte först och lägg bara till bild när den faktiskt tillför sammanhang.</span>
          </div>
        </section>

        <section className="grid content-start gap-4 rounded-[20px] border border-slate-200 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.03)]">
          <h2 className="m-0 text-lg text-slate-900">Förhandsvisning</h2>
          <div className="grid gap-3 rounded-[20px] border border-ui-border bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-4">
            {imageUrl.trim() ? (
              <div
                className="aspect-video w-full rounded-2xl border border-ui-border bg-cover bg-center"
                style={{ backgroundImage: `url(${imageUrl.trim()})` }}
              />
            ) : (
              <div className="grid aspect-video w-full place-items-center rounded-2xl border border-dashed border-slate-300 text-[13px] text-slate-400">Ingen bild vald</div>
            )}
            <div className="grid gap-2">
              <strong className="text-[22px] leading-[1.15] text-slate-900">{headline.trim() || 'Rubriken visas här'}</strong>
              <p className="m-0 whitespace-pre-wrap text-sm leading-[1.6] text-slate-600">{body.trim() || 'Brödtexten visas här när du börjar skriva nyheten.'}</p>
            </div>
          </div>
        </section>
      </section>
    </PageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}
