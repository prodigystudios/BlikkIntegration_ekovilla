"use client";
import { useEffect, useMemo, useRef, useState } from 'react';

type PagedList<T> = {
  page: number;
  pageSize: number;
  itemCount: number;
  totalItemCount: number;
  totalPages: number;
  items: T[];
};

export default function Home() {
  // Form state
  // New form fields for your order data
  const [projectNumber, setProjectNumber] = useState('');
  const [installerName, setInstallerName] = useState('');
  const [workStreet, setWorkStreet] = useState('');
  const [workPostalCode, setWorkPostalCode] = useState('');
  const [workCity, setWorkCity] = useState('');
  const [installationDate, setInstallationDate] = useState(''); // YYYY-MM-DD
  const [clientName, setClientName] = useState('');

  const [materialUsed, setMaterialUsed] = useState('');

  // Material properties: bag weight (kg/sack) and lambdavärde (W/m²K)
  const MATERIALS: Record<string, { bagWeight: number; lambda: string }> = useMemo(
    () => ({
      'Ekovilla Cellulosa Lösull CE ETA-09/0081': { bagWeight: 14, lambda: '0.038' },
      'Knauf Supafil Frame': { bagWeight: 16, lambda: '0.034' },
    }),
    []
  );

  const [eavesVentOk, setEavesVentOk] = useState(false); // Takfotsventilation OK?
  const [eavesVentComment, setEavesVentComment] = useState('');
  const [carpentryOk, setCarpentryOk] = useState(false); // Snickerier OK?
  const [carpentryComment, setCarpentryComment] = useState('');
  const [waterproofingOk, setWaterproofingOk] = useState(false); // Tätskikt OK?
  const [waterproofingComment, setWaterproofingComment] = useState('');

  // New Kontroller fields
  const [genomforningarOk, setGenomforningarOk] = useState(false); // Genomförningar OK?
  const [genomforningarComment, setGenomforningarComment] = useState('');
  const [grovstadningOk, setGrovstadningOk] = useState(false); // Grovstädning OK?
  const [grovstadningComment, setGrovstadningComment] = useState('');
  const [markskyltOk, setMarkskyltOk] = useState(false); // Märkskylt OK?
  const [markskyltComment, setMarkskyltComment] = useState('');
  const [ovrigaKommentarer, setOvrigaKommentarer] = useState(''); // Övriga kommentarer (no checkbox)

  type EtappOpenRow = {
    etapp?: string;
    ytaM2?: string;
    bestalldTjocklek?: string; // ex sättningspåslag
    sattningsprocent?: string; // %
    installeradTjocklek?: string; // inkl sättningspåslag
    installeradDensitet?: string; // kg/m2
    antalSack?: string; // - kg/m2
    lambdavarde?: string; // w/m2k
  };
  const [etapperOpen, setEtapperOpen] = useState<EtappOpenRow[]>([]);

  const addEtappOpenRow = () =>
    setEtapperOpen((rows) => [
      ...rows,
      { lambdavarde: MATERIALS[materialUsed]?.lambda },
    ]);
  const removeEtappOpenRow = (idx: number) => setEtapperOpen((rows) => rows.filter((_, i) => i !== idx));
  const updateEtappOpenRow = (idx: number, patch: Partial<EtappOpenRow>) =>
    setEtapperOpen((rows) => {
      const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      const row = next[idx];
      // If any inputs affecting density changed (and user isn't directly typing density), update density using the helper
      if (("ytaM2" in patch || "bestalldTjocklek" in patch || "antalSack" in patch) && !("installeradDensitet" in patch)) {
        const calc = CalculateDensityOnRow(row);
        next[idx] = {
          ...row,
          installeradDensitet: Number.isFinite(calc) && calc > 0 ? String(Math.round(calc * 100) / 100) : '',
        };
      }
      return next;
    });

  type EtappClosedRow = {
    etapp?: string; // Etapp(slutet)
    ytaM2?: string;
    bestalldTjocklek?: string; // Beställd tjocklek
    uppmatTjocklek?: string;   // Uppmät tjocklek
    installeradDensitet?: string; // Installerad densitet
    antalSackKgPerSack?: string;  // Antal säck kg/säck
    lambdavarde?: string; // Lamdavärde W/m2K
  };
  const [etapperClosed, setEtapperClosed] = useState<EtappClosedRow[]>([]);

  const addEtappClosedRow = () =>
    setEtapperClosed((rows) => [
      ...rows,
      { lambdavarde: MATERIALS[materialUsed]?.lambda },
    ]);
  const removeEtappClosedRow = (idx: number) => setEtapperClosed((rows) => rows.filter((_, i) => i !== idx));
  const updateEtappClosedRow = (idx: number, patch: Partial<EtappClosedRow>) =>
    setEtapperClosed((rows) => {
      const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      const row = next[idx];
      if (("ytaM2" in patch || "bestalldTjocklek" in patch || "antalSackKgPerSack" in patch) && !("installeradDensitet" in patch)) {
        const calc = CalculateDensityOnClosedRow(row);
        next[idx] = {
          ...row,
          installeradDensitet: Number.isFinite(calc) && calc > 0 ? String(Math.round(calc * 100) / 100) : '',
        };
      }
      return next;
    });

  const [message, setMessage] = useState<string | null>(null);
  const [orderId, setOrderId] = useState('');
  const [project, setProject] = useState<any | null>(null);
  const [openErrorIdxs, setOpenErrorIdxs] = useState<number[]>([]);
  const [closedErrorIdxs, setClosedErrorIdxs] = useState<number[]>([]);

  // Signature canvas refs/state
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const [signatureTimestamp, setSignatureTimestamp] = useState<string | null>(null);
  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Reset transform to clear entire backing store
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  setSignatureTimestamp(null);
  };
  const [signatureDateCity, setSignatureDateCity] = useState('');
  const getCanvasPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = signatureCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    let clientX = 0, clientY = 0;
    if ('touches' in e && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    return {
      x: (clientX - rect.left),
      y: (clientY - rect.top),
    };
  };
  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e);
    isDrawingRef.current = true;
    lastPosRef.current = pos;
    if (!signatureTimestamp) {
      setSignatureTimestamp(new Date().toISOString());
    }
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };
  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e);
    const last = lastPosRef.current || pos;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPosRef.current = pos;
  };
  const handleEnd = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDrawingRef.current = false;
    lastPosRef.current = null;
  };

  // Prepare canvas for high-DPI drawing
  useEffect(() => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = 600;
    const cssH = 180;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  // Validation helpers: require certain fields if a row has any data
  const isNonEmpty = (v: unknown) => String(v ?? '').trim() !== '';
  const REQUIRED_OPEN: (keyof EtappOpenRow)[] = ['etapp', 'ytaM2', 'bestalldTjocklek', 'antalSack', 'installeradDensitet'];
  const REQUIRED_CLOSED: (keyof EtappClosedRow)[] = ['etapp', 'ytaM2', 'bestalldTjocklek', 'uppmatTjocklek', 'antalSackKgPerSack', 'installeradDensitet'];
  function validateRows() {
    const openIdxs: number[] = [];
    const closedIdxs: number[] = [];
    etapperOpen.forEach((row, idx) => {
      const hasAny = Object.values(row).some(isNonEmpty);
      if (!hasAny) return; // empty row is okay (will be filtered out)
      const missing = REQUIRED_OPEN.some((k) => !isNonEmpty((row as any)[k]));
      if (missing) openIdxs.push(idx);
    });
    etapperClosed.forEach((row, idx) => {
      const hasAny = Object.values(row).some(isNonEmpty);
      if (!hasAny) return;
      const missing = REQUIRED_CLOSED.some((k) => !isNonEmpty((row as any)[k]));
      if (missing) closedIdxs.push(idx);
    });
    setOpenErrorIdxs(openIdxs);
    setClosedErrorIdxs(closedIdxs);
    if (openIdxs.length || closedIdxs.length) {
      const parts: string[] = [];
      if (openIdxs.length) parts.push(`Etapper (öppet): rader ${openIdxs.map((i) => i + 1).join(', ')}`);
      if (closedIdxs.length) parts.push(`Etapper (slutet): rader ${closedIdxs.map((i) => i + 1).join(', ')}`);
      setMessage(`Fyll i obligatoriska fält i: ${parts.join(' | ')}`);
      return false;
    }
    return true;
  }

  // Prefill form when project is loaded
  useEffect(() => {
    if (!project || project.error) return;
    const location = project.workSiteAddress || project.location || {};
    setClientName(project?.customer?.name || '');
    setWorkStreet(location?.streetAddress || '');
    setWorkPostalCode(location?.postalCode || '');
    setWorkCity(location?.city || '');
    // installation date -> prefer startDate, fallback to created
    const iso = (project?.startDate || project?.created || '').toString();
    const d = iso ? (iso.substring(0, 10) as string) : '';
    setInstallationDate(d);
  }, [project]);


  const onLookup = async () => {
    setProject(null);
    if (!orderId.trim()) return;
    try {
      const res = await fetch(`/api/projects/lookup?orderId=${encodeURIComponent(orderId.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Lookup failed');
      setProject(data);
    } catch (e: any) {
      setProject({ error: e.message });
    }
  };
  function CalculateDensityOnRow(etapp: EtappOpenRow): number {
    const { ytaM2, bestalldTjocklek, antalSack } = etapp;
  const bagWeight = MATERIALS[materialUsed]?.bagWeight ?? 0; // kg per bag
    if (!ytaM2 || !bestalldTjocklek || !antalSack || !bagWeight) return 0;
    const area = parseFloat(ytaM2);
    const thicknessMm = parseFloat(bestalldTjocklek);
    const bags = parseFloat(antalSack);
    if (isNaN(area) || isNaN(thicknessMm) || isNaN(bags) || area === 0 || thicknessMm === 0) return 0;
    const thicknessMeters = thicknessMm / 1000; // convert mm -> m
    const volumeM3 = area * thicknessMeters; // m³
    const totalKg = bags * bagWeight; // kg
    return totalKg / volumeM3; // kg/m³
  }

  function CalculateDensityOnClosedRow(etapp: EtappClosedRow): number {
    const { ytaM2, bestalldTjocklek, antalSackKgPerSack } = etapp;
  const bagWeight = MATERIALS[materialUsed]?.bagWeight ?? 0; // kg per bag
    if (!ytaM2 || !bestalldTjocklek || !antalSackKgPerSack || !bagWeight) return 0;
    const area = parseFloat(ytaM2);
    const thicknessMm = parseFloat(bestalldTjocklek);
    const bags = parseFloat(antalSackKgPerSack);
    if (isNaN(area) || isNaN(thicknessMm) || isNaN(bags) || area === 0 || thicknessMm === 0) return 0;
    const thicknessMeters = thicknessMm / 1000; // mm -> m
    const volumeM3 = area * thicknessMeters;
    const totalKg = bags * bagWeight;
    return totalKg / volumeM3; // kg/m³
  }

  // Recalculate densities when material (bag weight) changes
  useEffect(() => {
    const lambda = MATERIALS[materialUsed]?.lambda;
    setEtapperOpen((rows) =>
      rows.map((r) => {
        const calc = CalculateDensityOnRow(r);
        return {
          ...r,
          installeradDensitet: Number.isFinite(calc) && calc > 0 ? String(Math.round(calc * 100) / 100) : r.installeradDensitet || '',
          lambdavarde: r.lambdavarde && r.lambdavarde.trim() !== '' ? r.lambdavarde : (lambda ?? r.lambdavarde),
        };
      })
    );
  }, [materialUsed]);

  // Recalculate closed rows when material (bag weight) changes
  useEffect(() => {
    const lambda = MATERIALS[materialUsed]?.lambda;
    setEtapperClosed((rows) =>
      rows.map((r) => {
        const calc = CalculateDensityOnClosedRow(r);
        return {
          ...r,
          installeradDensitet: Number.isFinite(calc) && calc > 0 ? String(Math.round(calc * 100) / 100) : r.installeradDensitet || '',
          lambdavarde: r.lambdavarde && r.lambdavarde.trim() !== '' ? r.lambdavarde : (lambda ?? r.lambdavarde),
        };
      })
    );
  }, [materialUsed]);

  return (
  <main style={{ padding: 24, maxWidth: '100%', background: '#ffffffff' }}>
  <p>Sök efter order("Använd order nummer ifrån blikk")</p>

  <section style={{ marginTop: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>Order nummer</div>
          <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Ange ordernummer" style={{padding: 8 }} />
          <button style={{padding: 12 }} onClick={onLookup}>Sök projekt</button>
        </label>
        {project && (
          <div style={{ border: '1px solid #ddd', padding: 12 }}>
            {project.error ? (
              <div style={{ color: 'crimson' }}>Error: {project.error}</div>
            ) : (
              <div>
                <div><strong>Order number:</strong> {project.orderNumber}</div>
                <div><strong>Kund/Beställare:</strong> {project?.customer?.name}</div>
                <div><strong>Beskrivning:</strong> {String(project.description)}</div>
              </div>
            )}
          </div>
        )}
      </section>

  <section style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 720, alignSelf: 'stretch' }}>
        <h2>Projektdetaljer</h2>
        <label>
          <div>Kund/Beställare</div>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Kund/Beställare" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: 8 }} />
        </label>
          <div style={{ display: 'grid', gap: 8, width: '100%' }}>
          <div>Adress</div>
          <input value={workStreet} onChange={(e) => setWorkStreet(e.target.value)} placeholder="Gatuadress" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: 8 }} />
          <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'stretch' }}>
            <input value={workPostalCode} onChange={(e) => setWorkPostalCode(e.target.value)} placeholder="Postnummer" style={{ flex: 1, minWidth: 0, padding: 8 }} />
            <input value={workCity} onChange={(e) => setWorkCity(e.target.value)} placeholder="Stad" style={{ flex: 2, minWidth: 0, padding: 8 }} />
          </div>
        </div>
        <label>
          <div>Installationsdatum</div>
          <input
            type="date"
            value={installationDate}
            onChange={(e) => setInstallationDate(e.target.value)}
            style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: 8 }}
          />
        </label>
        <label>
          <div>Projektnummer(OBS FYLL I DETTA OM NI FÅTT ETT PROJEKT NUMMER FRÅN KUND)</div>
          <input value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} placeholder="Projektnummer" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: 8 }} />
        </label>
        <label>
          <div>Installatör</div>
          <input value={installerName} onChange={(e) => setInstallerName(e.target.value)} placeholder="Namn på installatör" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: 8 }} />
        </label>

        <label>
          <div>Material</div>
          <select className="select-field" value={materialUsed} onChange={(e) => setMaterialUsed(e.target.value)} style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
            <option value="">Välj material</option>
            <option value="Ekovilla Cellulosa Lösull CE ETA-09/0081">Ekovilla Cellulosa Lösull CE ETA-09/0081</option>
            <option value="Knauf Supafil Frame">Knauf Supafil Frame</option>
          </select>
          {materialUsed && (
            <small style={{ color: '#6b7280' }}>
              Vikt per säck: {MATERIALS[materialUsed]?.bagWeight ?? '—'} kg | Lambdavärde: {MATERIALS[materialUsed]?.lambda ?? '—'} W/m²K
            </small>
          )}
        </label>

        <div style={{ borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 16}}>
          <h3>Kontroller</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={eavesVentOk} onChange={(e) => setEavesVentOk(e.target.checked)} />
              <span>Takfotsventilation OK?</span>
            </label>
            <input value={eavesVentComment} onChange={(e) => setEavesVentComment(e.target.value)} placeholder="Kommentar (Takfotsventilation)" style={{padding: 8 }} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={carpentryOk} onChange={(e) => setCarpentryOk(e.target.checked)} />
              <span>Snickerier OK?</span>
            </label>
            <input value={carpentryComment} onChange={(e) => setCarpentryComment(e.target.value)} placeholder="Kommentar (Snickerier)" style={{padding: 8 }} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={waterproofingOk} onChange={(e) => setWaterproofingOk(e.target.checked)} />
              <span>Tätskikt OK?</span>
            </label>
            <input value={waterproofingComment} onChange={(e) => setWaterproofingComment(e.target.value)} placeholder="Kommentar (Tätskikt)" style={{padding: 8 }} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={genomforningarOk} onChange={(e) => setGenomforningarOk(e.target.checked)} />
              <span>Genomförningar OK?</span>
            </label>
            <input value={genomforningarComment} onChange={(e) => setGenomforningarComment(e.target.value)} placeholder="Kommentar (Genomförningar)" style={{padding: 8 }} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={grovstadningOk} onChange={(e) => setGrovstadningOk(e.target.checked)} />
              <span>Grovstädning OK?</span>
            </label>
            <input value={grovstadningComment} onChange={(e) => setGrovstadningComment(e.target.value)} placeholder="Kommentar (Grovstädning)" style={{padding: 8 }} />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={markskyltOk} onChange={(e) => setMarkskyltOk(e.target.checked)} />
              <span>Märkskylt OK?</span>
            </label>
            <input value={markskyltComment} onChange={(e) => setMarkskyltComment(e.target.value)} placeholder="Kommentar (Märkskylt)" style={{padding: 8 }} />

            <input value={ovrigaKommentarer} onChange={(e) => setOvrigaKommentarer(e.target.value)} placeholder="Övriga kommentarer" style={{padding: 8 }} />
          </div>
        </div>
          </section>
          
          <section style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3>Etapper (öppet)</h3>
            <button className='btn--med' type="button" onClick={addEtappOpenRow}>+ Lägg till rad</button>
          </div>
          <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden', maxWidth: '100%', WebkitOverflowScrolling: 'touch' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 100px 220px 130px 240px 170px 150px 170px', gap: 8, alignItems: 'center', fontWeight: 600, fontSize: 12, padding: '6px 0', minWidth: (140 + 100 + 220 + 130 + 240 + 170 + 150 + 170) + (7 * 8) }}>
              <div>Etapp (öppet)</div>
              <div>Yta m²</div>
              <div>Beställd tjocklek (ex sättningspåslag)</div>
              <div>Sättningspåslag %</div>
              <div>Installerad tjocklek (inkl sättningspåslag)</div>
              <div>Antal säck</div>
              <div>Installerad densitet kg/m³</div>
              <div>Lambdavärde W/m²K</div>
            </div>
            {etapperOpen.map((row, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '140px 100px 220px 130px 240px 170px 150px 170px', gap: 8, alignItems: 'center', marginBottom: 8, minWidth: (140 + 100 + 220 + 130 + 240 + 170 + 150 + 170) + (7 * 8), border: openErrorIdxs.includes(idx) ? '1px solid #fca5a5' : '1px solid transparent', background: openErrorIdxs.includes(idx) ? '#fff1f2' : undefined, padding: openErrorIdxs.includes(idx) ? 6 : 0 }}>
                <input value={row.etapp || ''} onChange={(e) => updateEtappOpenRow(idx, { etapp: e.target.value })} placeholder="Etapp (öppet)" style={{ padding: 6 }} />
                <input value={row.ytaM2 || ''} onChange={(e) => updateEtappOpenRow(idx, { ytaM2: e.target.value })} placeholder="m²" style={{ padding: 6 }} />
                <input value={row.bestalldTjocklek || ''} onChange={(e) => updateEtappOpenRow(idx, { bestalldTjocklek: e.target.value })} placeholder="mm" style={{ padding: 6 }} />
                <input value={row.sattningsprocent || ''} onChange={(e) => updateEtappOpenRow(idx, { sattningsprocent: e.target.value })} placeholder="%" style={{ padding: 6 }} />
                <input value={row.installeradTjocklek || ''} onChange={(e) => updateEtappOpenRow(idx, { installeradTjocklek: e.target.value })} placeholder="mm" style={{ padding: 6 }} />
                <input value={row.antalSack || ''} onChange={(e) => updateEtappOpenRow(idx, { antalSack: e.target.value })} placeholder="antal" style={{ padding: 6 }} />
                <input value={row.installeradDensitet || ''} onChange={(e) => updateEtappOpenRow(idx, { installeradDensitet: e.target.value })} placeholder="kg/m³" style={{ padding: 6 }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={row.lambdavarde || ''} onChange={(e) => updateEtappOpenRow(idx, { lambdavarde: e.target.value })} placeholder="W/m²K" style={{ padding: 6, flex: 1 }} />
                  <button className='btn--danger btn--sm' type="button" onClick={() => removeEtappOpenRow(idx)} style={{ whiteSpace: 'nowrap' }}>Ta bort</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3>Etapper (slutet)</h3>
            <button className='btn--med' type="button" onClick={addEtappClosedRow}>+ Lägg till rad</button>
          </div>
          <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden', maxWidth: '100%', WebkitOverflowScrolling: 'touch' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 100px 160px 160px 170px 170px 170px', gap: 8, alignItems: 'center', fontWeight: 600, fontSize: 12, padding: '6px 0', minWidth: (140 + 100 + 160 + 160 + 170 + 170 + 170) + (6 * 8) }}>
              <div>Etapp (slutet)</div>
              <div>Yta m²</div>
              <div>Beställd tjocklek</div>
              <div>Uppmät tjocklek</div>
              <div>Antal säck</div>
              <div>Installerad densitet kg/m³</div>
              <div>Lambdavärde W/m²K</div>
            </div>
            {etapperClosed.map((row, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '140px 100px 160px 160px 170px 170px 170px', gap: 8, alignItems: 'center', marginBottom: 8, minWidth: (140 + 100 + 160 + 160 + 170 + 170 + 170) + (6 * 8), border: closedErrorIdxs.includes(idx) ? '1px solid #fca5a5' : '1px solid transparent', background: closedErrorIdxs.includes(idx) ? '#fff1f2' : undefined, padding: closedErrorIdxs.includes(idx) ? 6 : 0 }}>
                <input value={row.etapp || ''} onChange={(e) => updateEtappClosedRow(idx, { etapp: e.target.value })} placeholder="Etapp (slutet)" style={{ padding: 6 }} />
                <input value={row.ytaM2 || ''} onChange={(e) => updateEtappClosedRow(idx, { ytaM2: e.target.value })} placeholder="m²" style={{ padding: 6 }} />
                <input value={row.bestalldTjocklek || ''} onChange={(e) => updateEtappClosedRow(idx, { bestalldTjocklek: e.target.value })} placeholder="mm" style={{ padding: 6 }} />
                <input value={row.uppmatTjocklek || ''} onChange={(e) => updateEtappClosedRow(idx, { uppmatTjocklek: e.target.value })} placeholder="mm" style={{ padding: 6 }} />
                <input value={row.antalSackKgPerSack || ''} onChange={(e) => updateEtappClosedRow(idx, { antalSackKgPerSack: e.target.value })} placeholder="antal" style={{ padding: 6 }} />
                <input value={row.installeradDensitet || ''} onChange={(e) => updateEtappClosedRow(idx, { installeradDensitet: e.target.value })} placeholder="kg/m³" style={{ padding: 6 }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={row.lambdavarde || ''} onChange={(e) => updateEtappClosedRow(idx, { lambdavarde: e.target.value })} placeholder="W/m²K" style={{ padding: 6, flex: 1 }} />
                  <button className='btn--danger btn--sm' type="button" onClick={() => removeEtappClosedRow(idx)} style={{ whiteSpace: 'nowrap' }}>Ta bort</button>
                </div>
              </div>
            ))}
          </div>
        </div>
          </section>
          <section style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3>Signatur</h3>
            <div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                <span>Datum och ort</span>
                <input value={signatureDateCity} onChange={(e) => setSignatureDateCity(e.target.value)} placeholder="YYYY-MM-DD, Ort" style={{ padding: 8, maxWidth: 400 }} />
              </label>
              <div style={{ border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden', width: '100%', maxWidth: 600 }}>
                <canvas
                  ref={signatureCanvasRef}
                  style={{ width: 600, height: 180, display: 'block', background: '#fff', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
                  onMouseDown={handleStart}
                  onMouseMove={handleMove}
                  onMouseUp={handleEnd}
                  onMouseLeave={handleEnd}
                  onTouchStart={handleStart}
                  onTouchMove={handleMove}
                  onTouchEnd={handleEnd}
                  onTouchCancel={handleEnd}
                />
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button className='btn--danger btn--sm' type="button" onClick={clearSignature}>Rensa signatur</button>
              </div>
            </div>
          </section>
          <section style={{ marginTop: 24, display: 'grid', gap: 12, maxWidth: 600, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn--success btn--lg" onClick={async () => {
                setMessage(null);
                if (!validateRows()) return;
                const payload = {
                  orderId: orderId.trim(),
                  projectNumber,
                  installerName,
                  workAddress: {
                    streetAddress: workStreet,
                    postalCode: workPostalCode,
                    city: workCity,
                  },
                  installationDate,
                  clientName,
                  materialUsed,
                  checks: {
                    takfotsventilation: { ok: eavesVentOk, comment: eavesVentComment },
                    snickerier: { ok: carpentryOk, comment: carpentryComment },
                    tatskikt: { ok: waterproofingOk, comment: waterproofingComment },
                    genomforningar: { ok: genomforningarOk, comment: genomforningarComment },
                    grovstadning: { ok: grovstadningOk, comment: grovstadningComment },
                    markskylt: { ok: markskyltOk, comment: markskyltComment },
                    ovrigaKommentarer: { comment: ovrigaKommentarer },
                  },
                  signatureDateCity,
                  signatureTimestamp,
                  signature: signatureCanvasRef.current?.toDataURL('image/png') || null,
                  etapperOpen: etapperOpen.filter(r => Object.values(r).some(v => String(v ?? '').trim() !== '')),
                  etapperClosed: etapperClosed.filter(r => Object.values(r).some(v => String(v ?? '').trim() !== '')),
                };
                try {
                  const res = await fetch('/api/pdf/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                  });
                  if (!res.ok) throw new Error(await res.text());
                  const arrayBuf = await res.arrayBuffer();
                  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
                  const sanitize = (s: string) => String(s || '').normalize('NFKD').replace(/[^\w\-\.]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
                  const clientPart = sanitize(clientName || 'client');
                  const orderPart = sanitize(orderId || projectNumber || 'order');
                  const filename = `Egenkontroll_${clientPart}_${orderPart}.pdf`;
                  const save = await fetch('/api/storage/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      fileName: filename,
                      pdfBytesBase64: base64,
                      folder: orderId || projectNumber || 'misc',
                      metadata: { orderId, projectNumber, clientName },
                    }),
                  });
                  const saved = await save.json();
                  if (!save.ok) throw new Error(saved?.error || 'Upload failed');
                  setMessage(`Sparat i arkiv: ${saved.path}`);
                } catch (e: any) {
                  setMessage(`Arkivering misslyckades: ${e.message}`);
                }
              }}>Spara till Arkiv</button>
            </div>

            {message && <div>{message}</div>}
          </section>
      
    </main>
  );
}
