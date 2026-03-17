'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'invalid'; message: string }
  | { kind: 'submitted' };

type OffertInfo = {
  offertNumber: string;
  totalBeforeRot: number;
  rotAmount: number;
  totalAfterRot: number;
};

function formatKr(value: number) {
  const v = Number.isFinite(value) ? value : 0;
  return `${Math.round(v).toLocaleString('sv-SE')} kr`;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#334155' }}>{children}</span>;
}

function Button({ children, onClick, disabled, variant = 'primary', type = 'button' as const }: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'plain';
  type?: 'button' | 'submit';
}) {
  const base: React.CSSProperties = {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #e5e7eb',
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
  const style = variant === 'primary'
    ? { ...base, background: disabled ? '#e5e7eb' : '#111827', color: '#fff', borderColor: '#111827' }
    : { ...base, background: '#fff', color: '#111827' };

  return (
    <button type={type} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}

function SignaturePad({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange('');
  };

  const redrawFromValue = () => {
    if (!value) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = value;
  };

  useEffect(() => {
    redrawFromValue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    lastPointRef.current = getPoint(e);
    (e.currentTarget as any).setPointerCapture?.(e.pointerId);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const p = getPoint(e);
    const last = lastPointRef.current;
    if (!last) {
      lastPointRef.current = p;
      return;
    }

    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    lastPointRef.current = p;
  };

  const end = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    onChange(dataUrl);
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: 10 }}>
        <canvas
          ref={canvasRef}
          width={900}
          height={240}
          style={{ width: '100%', height: 180, touchAction: 'none', display: 'block' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          aria-label="Signatur"
        />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>Rita din signatur i rutan ovan.</span>
        <Button variant="plain" onClick={clear}>Rensa</Button>
      </div>
    </div>
  );
}

export default function CustomerOffertTokenPage({ params }: { params: { token: string } }) {
  const token = String(params?.token || '').trim();

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [offertInfo, setOffertInfo] = useState<OffertInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [person1Name, setPerson1Name] = useState('');
  const [person1Personnummer, setPerson1Personnummer] = useState('');
  const [person2Name, setPerson2Name] = useState('');
  const [person2Personnummer, setPerson2Personnummer] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [propertyDesignation, setPropertyDesignation] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [existingInsulation, setExistingInsulation] = useState('');
  const [atticHatchType, setAtticHatchType] = useState<'inne' | 'ute'>('inne');
  const [otherInfo, setOtherInfo] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState('');

  const missing = useMemo(() => {
    const miss: string[] = [];

    const p1Name = person1Name.trim();
    const p1Pn = person1Personnummer.trim();
    const p2Name = person2Name.trim();
    const p2Pn = person2Personnummer.trim();

    const hasP1 = !!p1Name || !!p1Pn;
    const hasP2 = !!p2Name || !!p2Pn;

    const p1Complete = !!p1Name && !!p1Pn;
    const p2Complete = !!p2Name && !!p2Pn;

    if (!p1Complete && !p2Complete) {
      miss.push('Minst en person (namn + personnummer)');
    }

    if (hasP1 && !p1Complete) {
      if (!p1Name) miss.push('Namn (person 1)');
      if (!p1Pn) miss.push('Personnummer (person 1)');
    }

    if (hasP2 && !p2Complete) {
      if (!p2Name) miss.push('Namn (person 2)');
      if (!p2Pn) miss.push('Personnummer (person 2)');
    }

    if (!deliveryAddress.trim()) miss.push('Leveransadress');
    if (!postalCode.trim()) miss.push('Postnummer');
    if (!city.trim()) miss.push('Ort');
    if (!propertyDesignation.trim()) miss.push('Fastighetsbeteckning');
    if (!phone.trim()) miss.push('Telefonnummer');
    if (!email.trim()) miss.push('E-post');
    if (!existingInsulation.trim()) miss.push('Befintlig isolering');
    if (!signatureDataUrl.trim()) miss.push('Signatur');
    return miss;
  }, [
    person1Name,
    person1Personnummer,
    person2Name,
    person2Personnummer,
    deliveryAddress,
    postalCode,
    city,
    propertyDesignation,
    phone,
    email,
    existingInsulation,
    signatureDataUrl,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setLoadState({ kind: 'invalid', message: 'Ogiltig länk.' });
        return;
      }
      try {
        const res = await fetch(`/api/kund/offert/${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          const msg = j?.error || 'Länken är ogiltig eller redan använd.';
          if (cancelled) return;
          setLoadState({ kind: res.status === 410 ? 'submitted' : 'invalid', message: msg });
          return;
        }
        const j = await res.json().catch(() => null);
        if (!cancelled) {
          setOffertInfo({
            offertNumber: String(j?.offertNumber || '').trim(),
            totalBeforeRot: Number(j?.totalBeforeRot) || 0,
            rotAmount: Number(j?.rotAmount) || 0,
            totalAfterRot: Number(j?.totalAfterRot) || 0,
          });
        }
        if (cancelled) return;
        setLoadState({ kind: 'ready' });
      } catch (e: any) {
        if (cancelled) return;
        setLoadState({ kind: 'invalid', message: e?.message || 'Kunde inte ladda länken.' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);

    if (missing.length > 0) {
      setSubmitError(`Fyll i: ${missing.join(', ')}`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/kund/offert/${encodeURIComponent(token)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person1Name,
          person1Personnummer,
          person2Name,
          person2Personnummer,
          deliveryAddress,
          postalCode,
          city,
          propertyDesignation,
          phone,
          email,
          existingInsulation,
          atticHatchType,
          otherInfo,
          signatureDataUrl,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || 'Kunde inte skicka in. Försök igen.');
      }

      setLoadState({ kind: 'submitted' });
    } catch (e: any) {
      setSubmitError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadState.kind === 'loading') {
    return (
      <div style={{ padding: 16, maxWidth: 820, margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Kunduppgifter</h1>
        <p style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>Laddar…</p>
      </div>
    );
  }

  if (loadState.kind === 'invalid') {
    return (
      <div style={{ padding: 16, maxWidth: 820, margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Kunduppgifter</h1>
        <p style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>{loadState.message}</p>
      </div>
    );
  }

  if (loadState.kind === 'submitted') {
    return (
      <div style={{ padding: 16, maxWidth: 820, margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Tack!</h1>
        <p style={{ marginTop: 8, fontSize: 12, color: '#334155' }}>
          Vi har tagit emot dina uppgifter. Länken är nu låst.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 820, margin: '0 auto', display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Beställningsbekräftelse</h1>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
          Fyll i uppgifterna nedan för att godkänna mottagen offert med nr:{offertInfo?.offertNumber || '—'}. När du skickat in låses formuläret.
        </p>
      </div>

      {offertInfo && (
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff', display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 13 }}>OFFERT</strong>
          <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: '#64748b' }}>Offertnummer</span>
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{offertInfo.offertNumber || '—'}</span>
            </div>
            <div style={{ height: 1, background: '#e5e7eb' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: '#64748b' }}>Totalsumma (innan ROT)</span>
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatKr(offertInfo.totalBeforeRot)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: '#64748b' }}>ROT</span>
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>- {formatKr(offertInfo.rotAmount)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: '#64748b' }}>Totalsumma (efter ROT)</span>
              <span style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{formatKr(offertInfo.totalAfterRot)}</span>
            </div>
          </div>
        </section>
      )}

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff', display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 13 }}>PERSONER</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <FieldLabel>Namn (person 1)</FieldLabel>
              <input value={person1Name} onChange={(e) => setPerson1Name(e.target.value)} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <FieldLabel>Personnummer (person 1)</FieldLabel>
              <input value={person1Personnummer} onChange={(e) => setPerson1Personnummer(e.target.value)} placeholder="ÅÅÅÅMMDD-XXXX" style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <FieldLabel>Namn (person 2, valfritt)</FieldLabel>
              <input value={person2Name} onChange={(e) => setPerson2Name(e.target.value)} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <FieldLabel>Personnummer (person 2, valfritt)</FieldLabel>
              <input value={person2Personnummer} onChange={(e) => setPerson2Personnummer(e.target.value)} placeholder="ÅÅÅÅMMDD-XXXX" style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            </label>
          </div>
        </section>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff', display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 13 }}>LEVERANS</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, gridColumn: '1 / -1' }}>
              <FieldLabel>Leveransadress</FieldLabel>
              <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <FieldLabel>Postnummer</FieldLabel>
              <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <FieldLabel>Ort</FieldLabel>
              <input value={city} onChange={(e) => setCity(e.target.value)} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, gridColumn: '1 / -1' }}>
              <FieldLabel>Fastighetsbeteckning</FieldLabel>
              <input value={propertyDesignation} onChange={(e) => setPropertyDesignation(e.target.value)} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            </label>
          </div>
        </section>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff', display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 13 }}>KONTAKT</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <FieldLabel>Telefonnummer</FieldLabel>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <FieldLabel>E-post</FieldLabel>
              <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            </label>
          </div>
        </section>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff', display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 13 }}>ÖVRIGT</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, gridColumn: '1 / -1' }}>
              <FieldLabel>Befintlig isolering</FieldLabel>
              <input value={existingInsulation} onChange={(e) => setExistingInsulation(e.target.value)} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <FieldLabel>Typ av vindslucka</FieldLabel>
              <select value={atticHatchType} onChange={(e) => setAtticHatchType(e.target.value as any)} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <option value="inne">Inne</option>
                <option value="ute">Ute</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, gridColumn: '1 / -1' }}>
              <FieldLabel>Övrigt</FieldLabel>
              <textarea value={otherInfo} onChange={(e) => setOtherInfo(e.target.value)} rows={4} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, resize: 'vertical' }} />
            </label>
          </div>
        </section>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fff', display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 13 }}>SIGNATUR</strong>
          <SignaturePad value={signatureDataUrl} onChange={setSignatureDataUrl} />
        </section>

        {submitError && (
          <div style={{ fontSize: 12, color: '#b91c1c' }}>{submitError}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Skickar…' : 'Skicka in'}
          </Button>
        </div>
      </form>
    </div>
  );
}
