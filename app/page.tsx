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
      'Knauf Supafil Frame Lösull B0709EPCR': { bagWeight: 15.5, lambda: '0.038' },
      'Isocell/isEco cellulosa Lösull CE ETA-06/0076': { bagWeight: 12, lambda: '0.038' },
      'Hunton Nativo Träfiber Lösull DoP 02-04-01': { bagWeight: 14, lambda: '0.039' }
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
      // Auto-calc installeradTjocklek = beställd tjocklek + (beställd * sättningsprocent/100)
      if (("bestalldTjocklek" in patch || "sattningsprocent" in patch) && !("installeradTjocklek" in patch)) {
        const base = parseFloat(String(row.bestalldTjocklek ?? ''));
        const perc = parseFloat(String(row.sattningsprocent ?? ''));
        const installed = Number.isFinite(base) && Number.isFinite(perc)
          ? base + (base * (perc / 100))
          : NaN;
        next[idx] = {
          ...row,
          installeradTjocklek: Number.isFinite(installed) && installed > 0 ? String(Math.round(installed)) : '',
        };
      }
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
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  const autosaveTimer = useRef<number | null>(null);
  const restoredKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
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
  const getDraftKey = (id?: string) => `egenkontroll:draft:${(id ?? orderId) || 'no-order'}`;
  function collectDraft() {
    // Only persist signature if drawn; compress to JPEG to save space on mobile
    const signatureDataUrl = signatureTimestamp ? (signatureCanvasRef.current?.toDataURL('image/jpeg', 0.8) || null) : null;
    return {
      orderId,
      projectNumber,
      installerName,
      workStreet,
      workPostalCode,
      workCity,
      installationDate,
      clientName,
      materialUsed,
      checks: {
        eavesVentOk, eavesVentComment,
        carpentryOk, carpentryComment,
        waterproofingOk, waterproofingComment,
        genomforningarOk, genomforningarComment,
        grovstadningOk, grovstadningComment,
        markskyltOk, markskyltComment,
        ovrigaKommentarer,
      },
      signatureDateCity,
      signatureTimestamp,
      signatureDataUrl,
      etapperOpen,
      etapperClosed,
    };
  }
  function applyDraft(d: any) {
    try {
      if (!d || typeof d !== 'object') return;
      if (typeof d.orderId === 'string') setOrderId(d.orderId);
      if (typeof d.projectNumber === 'string') setProjectNumber(d.projectNumber);
      if (typeof d.installerName === 'string') setInstallerName(d.installerName);
      if (typeof d.workStreet === 'string') setWorkStreet(d.workStreet);
      if (typeof d.workPostalCode === 'string') setWorkPostalCode(d.workPostalCode);
      if (typeof d.workCity === 'string') setWorkCity(d.workCity);
      if (typeof d.installationDate === 'string') setInstallationDate(d.installationDate);
      if (typeof d.clientName === 'string') setClientName(d.clientName);
      if (typeof d.materialUsed === 'string') setMaterialUsed(d.materialUsed);
      if (d.checks && typeof d.checks === 'object') {
        if ('eavesVentOk' in d.checks) setEavesVentOk(!!d.checks.eavesVentOk);
        if ('eavesVentComment' in d.checks) setEavesVentComment(String(d.checks.eavesVentComment || ''));
        if ('carpentryOk' in d.checks) setCarpentryOk(!!d.checks.carpentryOk);
        if ('carpentryComment' in d.checks) setCarpentryComment(String(d.checks.carpentryComment || ''));
        if ('waterproofingOk' in d.checks) setWaterproofingOk(!!d.checks.waterproofingOk);
        if ('waterproofingComment' in d.checks) setWaterproofingComment(String(d.checks.waterproofingComment || ''));
        if ('genomforningarOk' in d.checks) setGenomforningarOk(!!d.checks.genomforningarOk);
        if ('genomforningarComment' in d.checks) setGenomforningarComment(String(d.checks.genomforningarComment || ''));
        if ('grovstadningOk' in d.checks) setGrovstadningOk(!!d.checks.grovstadningOk);
        if ('grovstadningComment' in d.checks) setGrovstadningComment(String(d.checks.grovstadningComment || ''));
        if ('markskyltOk' in d.checks) setMarkskyltOk(!!d.checks.markskyltOk);
        if ('markskyltComment' in d.checks) setMarkskyltComment(String(d.checks.markskyltComment || ''));
        if ('ovrigaKommentarer' in d.checks) setOvrigaKommentarer(String(d.checks.ovrigaKommentarer || ''));
      }
      if (typeof d.signatureDateCity === 'string') setSignatureDateCity(d.signatureDateCity);
      if (typeof d.signatureTimestamp === 'string') setSignatureTimestamp(d.signatureTimestamp);
      if (Array.isArray(d.etapperOpen)) setEtapperOpen(d.etapperOpen);
      if (Array.isArray(d.etapperClosed)) setEtapperClosed(d.etapperClosed);
      // Draw signature back to canvas
      const dataUrl: string | null = d.signatureDataUrl || null;
      if (dataUrl && signatureCanvasRef.current) {
        const img = new Image();
        img.onload = () => {
          const canvas = signatureCanvasRef.current!;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.restore();
          // Canvas already scaled for DPR in effect; draw image at 0,0 with CSS size mapping
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = dataUrl;
      }
    } catch {}
  }
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

  // Restore draft on mount (no-order key) and on orderId change (specific key)
  useEffect(() => {
    try {
      const key = getDraftKey();
      if (!restoredKeysRef.current.has(key)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          applyDraft(parsed);
          restoredKeysRef.current.add(key);
        }
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Debounced autosave of draft to localStorage
  useEffect(() => {
    const handler = () => {
      try {
        const key = getDraftKey();
        const data = collectDraft();
        localStorage.setItem(key, JSON.stringify(data));
      } catch {}
    };
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(handler, 800);
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
    // Include main fields and rows; signature is read on save from canvas inside collectDraft
  }, [orderId, projectNumber, installerName, workStreet, workPostalCode, workCity, installationDate, clientName, materialUsed, eavesVentOk, eavesVentComment, carpentryOk, carpentryComment, waterproofingOk, waterproofingComment, genomforningarOk, genomforningarComment, grovstadningOk, grovstadningComment, markskyltOk, markskyltComment, ovrigaKommentarer, signatureDateCity, signatureTimestamp, etapperOpen, etapperClosed]);

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

  function validateTopLevel(): boolean {
    const m: Record<string, boolean> = {};
    // Required top-level fields (Project number optional; Kontroll fields optional)
    if (!isNonEmpty(clientName)) m.clientName = true;
    if (!isNonEmpty(workStreet)) m.workStreet = true;
    if (!isNonEmpty(workPostalCode)) m.workPostalCode = true;
    if (!isNonEmpty(workCity)) m.workCity = true;
    if (!isNonEmpty(installationDate)) m.installationDate = true;
    if (!isNonEmpty(installerName)) m.installerName = true;
    if (!isNonEmpty(materialUsed)) m.materialUsed = true;
    if (!isNonEmpty(signatureDateCity)) m.signatureDateCity = true;
    // Require an actual signature drawn
    if (!signatureTimestamp) m.signature = true;
    // Require at least one filled row between open/closed
    const anyOpen = etapperOpen.some(r => Object.values(r).some(isNonEmpty));
    const anyClosed = etapperClosed.some(r => Object.values(r).some(isNonEmpty));
    if (!anyOpen && !anyClosed) m.rows = true;

    setMissing(m);
    if (Object.keys(m).length) {
      const parts: string[] = [];
      if (m.clientName) parts.push('Kund/Beställare');
      if (m.workStreet || m.workPostalCode || m.workCity) parts.push('Adress');
      if (m.installationDate) parts.push('Installationsdatum');
      if (m.installerName) parts.push('Installatör');
      if (m.materialUsed) parts.push('Material');
      if (m.rows) parts.push('Minst en etapp');
      if (m.signatureDateCity || m.signature) parts.push('Signatur (datum/ort + ritad signatur)');
      setMessage(`Fyll i obligatoriska fält: ${parts.join(' | ')}`);
      setToast({ text: 'Kontrollera obligatoriska fält', type: 'error' });
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
    
    // Prefill Etapper from description if present and tables are empty
    try {
      const desc: string = String(project?.description ?? '').trim();
      if (desc && etapperOpen.length === 0 && etapperClosed.length === 0) {
        const parsed = parseDescriptionToRows(desc);
        if (parsed.open.length) setEtapperOpen(parsed.open);
        if (parsed.closed.length) setEtapperClosed(parsed.closed);
      }
    } catch {}
  }, [project]);

  // Parse helper: "Vind - 102m2x500mm - 102eko" (also supports m² and ×)
  // Rule: only entries named "Vind" go to Etapper (öppet); all others to Etapper (slutet)
  function parseDescriptionToRows(desc: string): { open: EtappOpenRow[]; closed: EtappClosedRow[] } {
    const open: EtappOpenRow[] = [];
    const closed: EtappClosedRow[] = [];
    const re = /([A-Za-zÅÄÖåäö][A-Za-zÅÄÖåäö\s/()_-]*?)\s*-\s*(\d+[.,]?\d*)\s*m(?:2|²)\s*[x×]\s*(\d+[.,]?\d*)\s*mm\s*-\s*(\d+)\s*eko/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(desc)) !== null) {
      const rawName = (m[1] || '').trim();
      const nameNorm = rawName.toLowerCase();
      const areaStr = (m[2] || '').replace(',', '.');
      const thickStr = (m[3] || '').replace(',', '.');
      const sacksStr = (m[4] || '').trim();
      const area = isFinite(Number(areaStr)) ? String(Number(areaStr)) : '';
      const thickness = isFinite(Number(thickStr)) ? String(Number(thickStr)) : '';
      const sacks = /^\d+$/.test(sacksStr) ? sacksStr : '';

      const isVind = nameNorm === 'vind' || nameNorm.startsWith('vind');
      if (isVind) {
        open.push({
          etapp: rawName,
          ytaM2: area,
          bestalldTjocklek: thickness,
          sattningsprocent: '',
          installeradTjocklek: '',
          antalSack: sacks,
          installeradDensitet: '',
          lambdavarde: MATERIALS[materialUsed]?.lambda,
        });
      } else {
        closed.push({
          etapp: rawName,
          ytaM2: area,
          bestalldTjocklek: thickness,
          uppmatTjocklek: '',
          installeradDensitet: '',
          antalSackKgPerSack: sacks,
          lambdavarde: MATERIALS[materialUsed]?.lambda,
        });
      }
    }
    return { open, closed };
  }


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
        <h3>SE TILL ATT INFORMATIONEN SOM HÄMTATS FRÅN BLIKK STÄMMER</h3>
        <label>
          <div>Kund/Beställare</div>
          <input value={clientName} onChange={(e) => { setClientName(e.target.value); if (missing.clientName) setMissing((mm) => ({ ...mm, clientName: false })); }} placeholder="Kund/Beställare" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: 8, border: missing.clientName ? '1px solid #fca5a5' : undefined, background: missing.clientName ? '#fff1f2' : undefined }} />
        </label>
          <div style={{ display: 'grid', gap: 8, width: '100%' }}>
          <div>Adress</div>
          <input value={workStreet} onChange={(e) => { setWorkStreet(e.target.value); if (missing.workStreet) setMissing((mm) => ({ ...mm, workStreet: false })); }} placeholder="Gatuadress" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: 8, border: missing.workStreet ? '1px solid #fca5a5' : undefined, background: missing.workStreet ? '#fff1f2' : undefined }} />
          <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'stretch' }}>
            <input value={workPostalCode} onChange={(e) => { setWorkPostalCode(e.target.value); if (missing.workPostalCode) setMissing((mm) => ({ ...mm, workPostalCode: false })); }} placeholder="Postnummer" style={{ flex: 1, minWidth: 0, padding: 8, border: missing.workPostalCode ? '1px solid #fca5a5' : undefined, background: missing.workPostalCode ? '#fff1f2' : undefined }} />
            <input value={workCity} onChange={(e) => { setWorkCity(e.target.value); if (missing.workCity) setMissing((mm) => ({ ...mm, workCity: false })); }} placeholder="Stad" style={{ flex: 2, minWidth: 0, padding: 8, border: missing.workCity ? '1px solid #fca5a5' : undefined, background: missing.workCity ? '#fff1f2' : undefined }} />
          </div>
        </div>
        <label>
          <div>Installationsdatum</div>
          <input
            type="date"
            value={installationDate}
            onChange={(e) => { setInstallationDate(e.target.value); if (missing.installationDate) setMissing((mm) => ({ ...mm, installationDate: false })); }}
            style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: 8, border: missing.installationDate ? '1px solid #fca5a5' : undefined, background: missing.installationDate ? '#fff1f2' : undefined }}
          />
        </label>
        <label>
          <div>Projektnummer(OBS FYLL I DETTA OM NI FÅTT ETT PROJEKT NUMMER FRÅN KUND)</div>
          <input value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} placeholder="Projektnummer" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: 8 }} />
        </label>
        <label>
          <div>Installatör</div>
          <input value={installerName} onChange={(e) => { setInstallerName(e.target.value); if (missing.installerName) setMissing((mm) => ({ ...mm, installerName: false })); }} placeholder="Namn på installatör" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', padding: 8, border: missing.installerName ? '1px solid #fca5a5' : undefined, background: missing.installerName ? '#fff1f2' : undefined }} />
        </label>

        <label>
          <div>Material</div>
          <select className="select-field" value={materialUsed} onChange={(e) => { setMaterialUsed(e.target.value); if (missing.materialUsed) setMissing((mm) => ({ ...mm, materialUsed: false })); }} style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', border: missing.materialUsed ? '1px solid #fca5a5' : undefined, background: missing.materialUsed ? '#fff1f2' : undefined }}>
            <option value="">Välj material</option>
            <option value="Ekovilla Cellulosa Lösull CE ETA-09/0081">Ekovilla Cellulosa Lösull CE ETA-09/0081</option>
            <option value="Knauf Supafil Frame Lösull B0709EPCR">Knauf Supafil Frame Lösull B0709EPCR</option>
            <option value="Isocell/isEco cellulosa Lösull CE ETA-06/0076">Isocell/isEco cellulosa Lösull CE ETA-06/0076</option>
            <option value="Hunton Nativo Träfiber Lösull DoP 02-04-01">Hunton Nativo Träfiber Lösull DoP 02-04-01</option>
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
                <input value={signatureDateCity} onChange={(e) => { setSignatureDateCity(e.target.value); if (missing.signatureDateCity) setMissing((mm) => ({ ...mm, signatureDateCity: false })); }} placeholder="YYYY-MM-DD, Ort" style={{ padding: 8, maxWidth: 400, border: missing.signatureDateCity ? '1px solid #fca5a5' : undefined, background: missing.signatureDateCity ? '#fff1f2' : undefined }} />
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
                {missing.signature && (
                  <span className="text-error" style={{ fontSize: 12 }}>Rita signaturen i rutan</span>
                )}
              </div>
            </div>
          </section>
          <section style={{ marginTop: 24, display: 'grid', gap: 12, maxWidth: 600, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn--success btn--lg"
                disabled={isSaving}
                onClick={async () => {
                  if (isSaving) return;
                  setMessage('Sparar…');
                  // Validate rows and top-level fields
                  const rowsOk = validateRows();
                  const topOk = validateTopLevel();
                  if (!rowsOk || !topOk) return;
                  setIsSaving(true);
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
                  setToast({ text: 'Sparat i arkiv', type: 'success' });
                  // Clear draft after successful archive save
                  try { localStorage.removeItem(getDraftKey()); localStorage.removeItem(getDraftKey('no-order')); } catch {}

                  // Optionally add a comment to the Blikk project to note completion (with download link)
                  try {
                    const blikkProjectId = project?.id || project?.projectId; // depending on API shape
                    if (blikkProjectId) {
                      const today = new Date();
                      const yyyy = today.getFullYear();
                      const mm = String(today.getMonth() + 1).padStart(2, '0');
                      const dd = String(today.getDate()).padStart(2, '0');
                      const dateStr = `${yyyy}-${mm}-${dd}`;
                      const commentPieces = [`Egenkontroll gjord ${dateStr}.`];
                      try {
                        const origin = typeof window !== 'undefined' ? window.location.origin : '';
                        if (origin && saved?.path) {
                          const downloadUrl = `${origin}/api/storage/download?path=${encodeURIComponent(saved.path)}`;
                          commentPieces.push(`Ladda ner PDF: ${downloadUrl}`);
                        }
                      } catch {}
                      // If you want to tag people, add handles here (Blikk must support @mentions in API):
                      // commentPieces.push('@patrikvall');
                      const commentText = commentPieces.join(' ');
                      await fetch('/api/blikk/project/comment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ projectId: blikkProjectId, text: commentText }),
                      });
                    }
                  } catch {
                    // Non-fatal if comment fails
                  }
                } catch (e: any) {
                  setMessage(`Arkivering misslyckades: ${e.message}`);
                  setToast({ text: `Arkivering misslyckades`, type: 'error' });
                } finally {
                  setIsSaving(false);
                }
              }}>
                {isSaving ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                      <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="4" fill="none" />
                      <path d="M22 12a10 10 0 0 1-10 10" stroke="#10b981" strokeWidth="4" fill="none">
                        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
                      </path>
                    </svg>
                    Sparar…
                  </span>
                ) : (
                  'Spara till Arkiv'
                )}
              </button>
            </div>

            {message && !toast && <div>{message}</div>}
          </section>
      
    {isSaving && (
      <div
        style={{
          position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 50,
        }}
      >
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="#e5e7eb" strokeWidth="4" fill="none" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="#10b981" strokeWidth="4" fill="none">
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
            </path>
          </svg>
          <div style={{ fontWeight: 500 }}>Sparar till arkiv…</div>
        </div>
      </div>
    )}

    {toast && (
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)',
          background: '#fff', border: `1px solid ${toast.type === 'success' ? '#10b981' : '#ef4444'}`,
          color: '#111827', borderRadius: 12, padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
          zIndex: 60,
        }}
      >
        {toast.type === 'success' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <path d="M9 12.5l2 2 4-5" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="12" r="10" fill="none" stroke="#ef4444" strokeWidth="2" />
            <path d="M12 7v6M12 17h.01" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
        <span style={{ fontWeight: 500 }}>{toast.text}</span>
      </div>
    )}
    </main>
  );
}
