"use client";
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export interface TimeReportModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit?: (payload: {
    editId?: string | null;
    date: string;
    start: string;
    end: string;
    breakMinutes: number;
    projectId?: string; // Blikk project id from my_jobs
    project?: string;
    description?: string;
    totalHours: number;
    timecodeId?: string; // Blikk time code id
    timecodeCode?: string | null; // Optional human code from Blikk
    activityId?: string; // Blikk activity id
    activityCode?: string | null; // Optional human code
    activityName?: string | null; // Human name
    reportType?: 'project' | 'internal' | 'absence';
    internalProjectId?: string | null;
    absenceProjectId?: string | null;
  }) => void;
  // Optional prefill when opening from context (e.g., a project card)
  initialProject?: string | null;
  initialProjectId?: string | null;
  initialDate?: string | null; // YYYY-MM-DD
  // Edit-mode optional prefills
  editId?: string | null;
  initialStart?: string | null;
  initialEnd?: string | null;
  initialBreakMinutes?: number | null;
  initialDescription?: string | null;
  initialTimecodeId?: string | null;
  initialActivityId?: string | null;
  initialReportType?: 'project' | 'internal' | 'absence' | null;
  initialInternalProjectId?: string | null;
  initialAbsenceProjectId?: string | null;
}

export default function TimeReportModal({ open, onClose, onSubmit, initialProject, initialProjectId, initialDate, editId: propEditId, initialStart, initialEnd, initialBreakMinutes, initialDescription, initialTimecodeId, initialActivityId, initialReportType, initialInternalProjectId, initialAbsenceProjectId }: TimeReportModalProps) {
  const [isSmall, setIsSmall] = useState(false); // <= 640px
  const [isXS, setIsXS] = useState(false); // <= 420px
  const [date, setDate] = useState<string>('');
  const [start, setStart] = useState<string>('');
  const [end, setEnd] = useState<string>('');
  const [breakMin, setBreakMin] = useState<string>('0');
  const [project, setProject] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [desc, setDesc] = useState<string>('');
  const [submitted, setSubmitted] = useState<'idle' | 'saving' | 'saved'>('idle');
  // Report type (normal project, internal project, absence project)
  const [reportType, setReportType] = useState<'project' | 'internal' | 'absence'>('project');
  // Time codes (from Blikk) state
  const [timecodes, setTimecodes] = useState<Array<{ id: string; name: string | null; code: string | null; billable: boolean | null; active: boolean | null }>>([]);
  const [tcLoading, setTcLoading] = useState(false);
  const [tcError, setTcError] = useState<string | null>(null);
  const [selectedTimecode, setSelectedTimecode] = useState<string>('');
  // Activities (Blikk) state
  const [activities, setActivities] = useState<Array<{ id: string; name: string | null; code: string | null; billable: boolean | null; active: boolean | null }>>([]);
  const [actLoading, setActLoading] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<string>('');
  // Internal projects state
  const [internalProjects, setInternalProjects] = useState<Array<{ id: string; name: string | null; active: boolean | null; commentRequired: boolean | null }>>([]);
  const [iLoading, setILoading] = useState(false);
  const [iError, setIError] = useState<string | null>(null);
  const [selectedInternalId, setSelectedInternalId] = useState<string>('');
  // Absence projects state
  const [absenceProjects, setAbsenceProjects] = useState<Array<{ id: string; name: string | null; active: boolean | null; commentRequired: boolean | null }>>([]);
  const [aLoading, setALoading] = useState(false);
  const [aError, setAError] = useState<string | null>(null);
  const [selectedAbsenceId, setSelectedAbsenceId] = useState<string>('');
  // Today's jobs quick-select state
  const supabase = createClientComponentClient();
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [todayJobs, setTodayJobs] = useState<Array<{ project_id: string; project_name: string | null; order_number: string | null; customer: string | null }>>([]);

  const selectedTc = useMemo(() => timecodes.find(tc => tc.id === selectedTimecode) || null, [timecodes, selectedTimecode]);
  const selectedAct = useMemo(() => activities.find(a => a.id === selectedActivity) || null, [activities, selectedActivity]);

  // Derive distinct projects for quick select (avoid duplicates if multiple segments per project in a day)
  const distinctProjects = useMemo(() => {
    const map = new Map<string, { project_id: string; project_name: string | null; order_number: string | null; customer: string | null }>();
    for (const j of todayJobs) {
      if (!map.has(j.project_id)) map.set(j.project_id, j);
    }
    return Array.from(map.values());
  }, [todayJobs]);

  useEffect(() => {
    const calc = () => {
      const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
      setIsSmall(w <= 640);
      setIsXS(w <= 420);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  useEffect(() => {
    if (!open) return;
    try {
      const today = new Date();
      const iso = today.toISOString().slice(0, 10);
      setDate(prev => (initialDate || prev || iso));
    } catch {}
    // Reset / prefill selections depending on edit mode
    setSelectedTimecode(initialTimecodeId || '');
    setSelectedActivity(initialActivityId || '');
    setSelectedInternalId(initialInternalProjectId || '');
    setSelectedAbsenceId(initialAbsenceProjectId || '');
    setReportType(initialReportType || 'project');
    if (initialProjectId) {
      setSelectedProjectId(String(initialProjectId));
    } else {
      setSelectedProjectId(null);
    }
    if (initialProject) {
      setProject(String(initialProject));
    } else {
      setProject('');
    }
    if (initialStart) setStart(initialStart);
    if (initialEnd) setEnd(initialEnd);
    if (typeof initialBreakMinutes === 'number') setBreakMin(String(initialBreakMinutes));
    if (typeof initialDescription === 'string') setDesc(initialDescription);
  }, [open, initialProject, initialProjectId, initialDate, initialStart, initialEnd, initialBreakMinutes, initialDescription, initialTimecodeId, initialActivityId, initialReportType, initialInternalProjectId, initialAbsenceProjectId]);

  // Load internal projects when needed
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || reportType !== 'internal') return;
      setILoading(true);
      setIError(null);
      try {
        const res = await fetch('/api/blikk/internal-projects?page=1&limit=200');
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || j?.error) {
          setIError(j?.error || 'Kunde inte hämta internprojekt');
          setInternalProjects([]);
          setSelectedInternalId('');
        } else {
          const items = Array.isArray(j?.data?.items) ? j.data.items : (Array.isArray(j?.items) ? j.items : []);
          const mapped = items.map((it: any) => ({
            id: String(it.id ?? ''),
            name: (it.name ?? null) as string | null,
            active: (typeof it.isActive === 'boolean' ? it.isActive : (typeof it.active === 'boolean' ? it.active : null)) as boolean | null,
            commentRequired: (typeof it.commentRequiredWhenTimeReporting === 'boolean' ? it.commentRequiredWhenTimeReporting : null) as boolean | null,
          })).filter((x: any) => x.id);
          setInternalProjects(mapped);
          if (mapped.length > 0) {
            setSelectedInternalId((prev) => (prev && mapped.some((m: { id: string }) => m.id === prev)) ? prev : mapped[0].id);
          } else {
            setSelectedInternalId('');
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setIError('Fel vid hämtning av internprojekt');
          setInternalProjects([]);
          setSelectedInternalId('');
        }
      } finally {
        if (!cancelled) setILoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, reportType]);

  // Load absence projects when needed
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || reportType !== 'absence') return;
      setALoading(true);
      setAError(null);
      try {
        const res = await fetch('/api/blikk/absence-projects?page=1&limit=200');
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || j?.error) {
          setAError(j?.error || 'Kunde inte hämta frånvaroprojekt');
          setAbsenceProjects([]);
          setSelectedAbsenceId('');
        } else {
          const items = Array.isArray(j?.data?.items) ? j.data.items : (Array.isArray(j?.items) ? j.items : []);
          const mapped = items.map((it: any) => ({
            id: String(it.id ?? ''),
            name: (it.name ?? null) as string | null,
            active: (typeof it.isActive === 'boolean' ? it.isActive : (typeof it.active === 'boolean' ? it.active : null)) as boolean | null,
            commentRequired: (typeof it.commentRequiredWhenTimeReporting === 'boolean' ? it.commentRequiredWhenTimeReporting : null) as boolean | null,
          })).filter((x: any) => x.id);
          setAbsenceProjects(mapped);
          if (mapped.length > 0) {
            setSelectedAbsenceId((prev) => (prev && mapped.some((m: { id: string }) => m.id === prev)) ? prev : mapped[0].id);
          } else {
            setSelectedAbsenceId('');
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setAError('Fel vid hämtning av frånvaroprojekt');
          setAbsenceProjects([]);
          setSelectedAbsenceId('');
        }
      } finally {
        if (!cancelled) setALoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, reportType]);

  // Load time codes when modal opens
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open) return;
      setTcLoading(true);
      setTcError(null);
      try {
        const res = await fetch('/api/blikk/timecodes?page=1&pageSize=200');
        const j = await res.json().catch(() => ({ items: [] }));
        if (cancelled) return;
        if (!res.ok) {
          setTcError(j?.error || 'Kunde inte hämta tidkoder');
          setTimecodes([]);
        } else {
          const items = Array.isArray(j?.items) ? j.items : [];
          // Normalize
          const mapped = items.map((it: any) => ({
            id: String(it.id ?? it.code ?? ''),
            name: (it.name ?? it.code ?? null) as string | null,
            code: (it.code ?? null) != null ? String(it.code) : null,
            billable: (typeof it.billable === 'boolean' ? it.billable : (typeof it.isBillable === 'boolean' ? it.isBillable : null)) as boolean | null,
            active: (typeof it.active === 'boolean' ? it.active : (typeof it.isActive === 'boolean' ? it.isActive : null)) as boolean | null,
          })).filter((x: any) => x.id);
          setTimecodes(mapped);
          if (mapped.length > 0) {
            setSelectedTimecode((prev) => {
              // Keep previous if still valid; otherwise pick first
              if (prev && mapped.some((m: { id: string }) => m.id === prev)) return prev;
              return mapped[0].id;
            });
          } else {
            setSelectedTimecode('');
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setTcError('Fel vid hämtning av tidkoder');
          setTimecodes([]);
        }
      } finally {
        if (!cancelled) setTcLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Load activities when modal opens
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open) return;
      setActLoading(true);
      setActError(null);
      try {
        const res = await fetch('/api/blikk/activities?page=1&pageSize=200');
        const j = await res.json().catch(() => ({ items: [] }));
        if (cancelled) return;
        if (!res.ok) {
          setActError(j?.error || 'Kunde inte hämta aktiviteter');
          setActivities([]);
        } else {
          const items = Array.isArray(j?.items) ? j.items : [];
          const mapped = items.map((it: any) => ({
            id: String(it.id ?? it.code ?? ''),
            name: (it.name ?? it.code ?? null) as string | null,
            code: (it.code ?? null) != null ? String(it.code) : null,
            billable: (typeof it.billable === 'boolean' ? it.billable : (typeof it.isBillable === 'boolean' ? it.isBillable : null)) as boolean | null,
            active: (typeof it.active === 'boolean' ? it.active : (typeof it.isActive === 'boolean' ? it.isActive : null)) as boolean | null,
          })).filter((x: any) => x.id);
          setActivities(mapped);
          // Auto-select the common default activity "lösullsentrepenad" if present; else first.
          if (mapped.length > 0) {
            const normalize = (s: string) => s
              .normalize('NFD')
              .replace(/\p{Diacritic}/gu, '')
              .toLowerCase();
            const targetNorm = normalize('Lösullsentrepenad');
            const preferred = mapped.find((a: { id: string; name: string | null; code: string | null; billable: boolean | null; active: boolean | null }) => {
              const hay = normalize([a.name || '', a.code || ''].filter(Boolean).join(' '));
              return hay === targetNorm || hay.includes(targetNorm);
            }) || null;
            const pickId = (preferred || mapped[3]).id;
            setSelectedActivity((prev) => {
              if (prev && mapped.some((a: { id: string }) => a.id === prev)) return prev;
              return pickId;
            });
          } else {
            setSelectedActivity('');
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setActError('Fel vid hämtning av aktiviteter');
          setActivities([]);
        }
      } finally {
        if (!cancelled) setActLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Load today's jobs when modal opens or date changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || !date) return;
      setJobsLoading(true);
      setJobsError(null);
      try {
        const { data, error } = await supabase.rpc('get_my_jobs', { start_date: date, end_date: date });
        if (cancelled) return;
        if (error) {
          console.warn('[time-report] get_my_jobs error', error);
          setTodayJobs([]);
          setJobsError('Kunde inte hämta dagens projekt');
        } else {
          // Map shape: we only keep needed fields
          const rows = Array.isArray(data) ? data : [];
          const mapped = rows.map(r => ({
            project_id: String((r as any).project_id || ''),
            project_name: (r as any).project_name || null,
            order_number: (r as any).order_number || null,
            customer: (r as any).customer || null,
          })).filter(r => r.project_id);
          setTodayJobs(mapped);
        }
      } catch (e: any) {
        if (!cancelled) {
          setJobsError('Fel vid hämtning');
          setTodayJobs([]);
        }
      } finally {
        if (!cancelled) setJobsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, date, supabase]);

  // When user switches to Internal or Absence tab, auto-select the "Intern" activity to avoid mistakes.
  // Skip forcing in edit mode (propEditId) to avoid altering existing reports accidentally.
  const lastForcedTypeRef = useRef<'internal' | 'absence' | null>(null);
  useEffect(() => {
    if (!open) return;
    if (propEditId) return; // don't force during edit of an existing record
    const isSpecial = reportType === 'internal' || reportType === 'absence';
    if (!isSpecial) { lastForcedTypeRef.current = null; return; }
    if (activities.length === 0) return; // wait until activities loaded
    if (lastForcedTypeRef.current === reportType) return; // already forced for this type

    const normalize = (s: string) => s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    const target = 'intern';
    const internActivity = activities.find(a => {
      const hay = normalize([a.name || '', a.code || ''].filter(Boolean).join(' '));
      return hay === target || hay.includes(target);
    });
    if (internActivity) {
      setSelectedActivity(internActivity.id);
      lastForcedTypeRef.current = reportType;
    }
  }, [open, reportType, activities, propEditId]);

  // When switching back to normal project tab, restore the default project activity ("Lösullsentrepenad").
  useEffect(() => {
    if (!open) return;
    if (propEditId) return; // don't override when editing existing reports
    if (reportType !== 'project') return;
    if (activities.length === 0) return;
    const normalize = (s: string) => s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    const target = 'losullsentreprenad';
    const preferred = activities.find(a => {
      const hay = normalize([a.name || '', a.code || ''].filter(Boolean).join(' '));
      return hay === target || hay.includes(target);
    }) || null;
    if (preferred) {
      setSelectedActivity(preferred.id);
    }
  }, [open, reportType, activities, propEditId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Prevent background scroll while modal open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const totalHours = useMemo(() => {
    const toMin = (t: string) => {
      const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t);
      if (!m) return null;
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    };
    const s = toMin(start);
    const e = toMin(end);
    if (s == null || e == null) return 0;
    let mins = e - s;
    const br = Math.max(0, parseInt(breakMin || '0', 10) || 0);
    mins -= br;
    if (mins < 0) return 0;
    return Math.round((mins / 60) * 100) / 100;
  }, [start, end, breakMin]);

  const validationError = useMemo(() => {
    const timeRx = /^([01]?\d|2[0-3]):([0-5]\d)$/;
    if (!start || !end) return null; // don't validate until both provided
    if (!timeRx.test(start) || !timeRx.test(end)) return 'Ogiltigt tidsformat (HH:MM).';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const s = sh * 60 + sm;
    const e = eh * 60 + em;
    if (e <= s) return 'Sluttid måste vara efter starttid.';
    const br = Math.max(0, parseInt(breakMin || '0', 10) || 0);
    if (br >= (e - s)) return 'Rast kan inte vara längre än arbetstiden.';
    return null;
  }, [start, end, breakMin]);

  const requireComment = useMemo(() => {
    if (reportType === 'internal') {
      const it = internalProjects.find(x => x.id === selectedInternalId);
      return !!it?.commentRequired;
    }
    if (reportType === 'absence') {
      const it = absenceProjects.find(x => x.id === selectedAbsenceId);
      return !!it?.commentRequired;
    }
    return false;
  }, [reportType, internalProjects, selectedInternalId, absenceProjects, selectedAbsenceId]);

  const hasTarget = (reportType === 'project' && selectedProjectId) || (reportType === 'internal' && selectedInternalId) || (reportType === 'absence' && selectedAbsenceId);
  const canSubmit = date && start && end && totalHours > 0 && !validationError && !!hasTarget && (!requireComment || (desc.trim().length > 0)) && submitted !== 'saving';

  const handleSubmit = () => {
    if (!canSubmit) return;
    setSubmitted('saving');
    const payload = {
      editId: propEditId || null,
      date,
      start,
      end,
      breakMinutes: Math.max(0, parseInt(breakMin || '0', 10) || 0),
      projectId: reportType === 'project' ? (selectedProjectId || undefined) : undefined,
      project: project.trim() || undefined,
      description: desc.trim() || undefined,
      totalHours,
      timecodeId: selectedTimecode || undefined,
      timecodeCode: selectedTc ? selectedTc.code : null,
      activityId: selectedActivity || undefined,
      activityCode: selectedAct ? selectedAct.code : null,
      activityName: selectedAct ? selectedAct.name : null,
      reportType,
      internalProjectId: reportType === 'internal' ? (selectedInternalId || null) : null,
      absenceProjectId: reportType === 'absence' ? (selectedAbsenceId || null) : null,
    };
    try {
      onSubmit?.(payload);
    } catch {}
    setTimeout(() => {
      setSubmitted('saved');
      setTimeout(() => {
        setSubmitted('idle');
        onClose();
        // optionally clear inputs after close
      }, 600);
    }, 400);
  };

  const chooseProject = useCallback((p: { project_id: string; project_name: string | null; order_number: string | null }) => {
    // Prefer order number; else project name; fallback to id
    const val = p.order_number ? `#${p.order_number}` : (p.project_name || p.project_id);
    setProject(val);
    setSelectedProjectId(p.project_id);
  }, []);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Rapportera arbetstid"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 1000, display: 'flex', alignItems: isXS ? 'stretch' : 'center', justifyContent: 'center', padding: isXS ? 0 : 16, touchAction: 'manipulation' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: isXS ? '100%' : 'min(100%, 700px)', maxHeight: isXS ? '100vh' : '85vh', height: isXS ? '100vh' : undefined, overflow: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', background: '#fff', border: '1px solid #e5e7eb', borderRadius: isXS ? 0 : 14, boxShadow: isXS ? 'none' : '0 20px 40px rgba(0,0,0,0.15)' }}>
        <div style={{ position:'sticky', top:0, zIndex:5, background:'#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: isSmall ? 12 : 14, paddingRight: isSmall ? 12 : 14, paddingTop: isXS ? 'max(10px, env(safe-area-inset-top))' : (isSmall ? 10 : 12), paddingBottom: isSmall ? 10 : 12, borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 16, height: 16, borderRadius: 999, background: '#22c55e', border: '2px solid #bbf7d0' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Rapportera tid</div>
          </div>
          <button onClick={onClose} className="btn--plain" aria-label="Stäng" style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: isSmall ? '10px 14px' : '8px 12px', minHeight: 44, background: '#fff' }}>Stäng</button>
        </div>
        <div style={{ padding: isSmall ? 12 : 14, display: 'grid', gap: isSmall ? 10 : 12 }}>
            {/* Report type selector */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: isSmall ? 13 : 12, color: '#334155' }}>Typ:</span>
              <div role="tablist" aria-label="Rapporttyp" style={{ display:'inline-flex', border:'1px solid #cbd5e1', borderRadius: 10, overflow:'hidden' }}>
                {([
                  { key:'project', label:'Projekt' },
                  { key:'internal', label:'Intern' },
                  { key:'absence', label:'Frånvaro' },
                ] as const).map(opt => (
                  <button key={opt.key} type="button" role="tab" aria-selected={reportType===opt.key}
                    onClick={()=>setReportType(opt.key)}
                    style={{ padding: isSmall ? '8px 10px' : '6px 10px', fontSize: isSmall ? 13 : 12, background: reportType===opt.key ? '#16a34a' : '#fff', color: reportType===opt.key ? '#fff' : '#0f172a', borderRight:'1px solid #cbd5e1' }}
                  >{opt.label}</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isSmall ? '1fr' : 'repeat(2, minmax(160px, 1fr))', gap: isXS ? 8 : 10 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: isSmall ? 13 : 12 }}>
              <span>Datum</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ padding: isSmall ? '12px 14px' : '8px 10px', fontSize: isSmall ? 16 : 14, minHeight: isSmall ? 44 : 36, border: '1px solid #cbd5e1', borderRadius: 10 }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: isXS ? '1fr' : '1fr 1fr', gap: isXS ? 8 : 10 }}>
              <label style={{ display: 'grid', gap: 4, fontSize: isSmall ? 13 : 12 }}>
                <span>Start</span>
                  <input type="time" value={start} onChange={e => setStart(e.target.value)} placeholder="07:00" style={{ padding: isSmall ? '12px 14px' : '8px 10px', fontSize: isSmall ? 16 : 14, minHeight: isSmall ? 44 : 36, border: `1px solid ${validationError ? '#fecaca' : '#cbd5e1'}`, borderRadius: 10 }} />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: isSmall ? 13 : 12 }}>
                <span>Slut</span>
                  <input type="time" value={end} onChange={e => setEnd(e.target.value)} placeholder="16:00" style={{ padding: isSmall ? '12px 14px' : '8px 10px', fontSize: isSmall ? 16 : 14, minHeight: isSmall ? 44 : 36, border: `1px solid ${validationError ? '#fecaca' : '#cbd5e1'}`, borderRadius: 10 }} />
              </label>
            </div>
              {validationError && (
                <div role="alert" style={{ gridColumn: '1 / -1', fontSize: isSmall ? 12 : 11, color: '#b91c1c' }}>{validationError}</div>
              )}
            <label style={{ display: 'grid', gap: 4, fontSize: isSmall ? 13 : 12 }}>
              <span>Rast (minuter)</span>
              <input inputMode="numeric" pattern="[0-9]*" value={breakMin} onChange={e => setBreakMin(e.target.value)} placeholder="0" style={{ padding: isSmall ? '12px 14px' : '8px 10px', fontSize: isSmall ? 16 : 14, minHeight: isSmall ? 44 : 36, border: '1px solid #cbd5e1', borderRadius: 10 }} />
            </label>
            <div style={{ display: 'grid', gap: 6 }}>
              {reportType === 'project' && (
                <label style={{ display: 'grid', gap: 4, fontSize: isSmall ? 13 : 12 }}>
                  <span>Projekt / Ordernummer</span>
                  <input value={project} onChange={e => setProject(e.target.value)} placeholder="#1234 eller projektnamn" style={{ padding: isSmall ? '12px 14px' : '8px 10px', fontSize: isSmall ? 16 : 14, minHeight: isSmall ? 44 : 36, border: '1px solid #cbd5e1', borderRadius: 10 }} />
                </label>
              )}
              {reportType === 'internal' && (
                <label style={{ display: 'grid', gap: 4, fontSize: isSmall ? 13 : 12 }}>
                  <span>Internprojekt</span>
                  <select value={selectedInternalId} onChange={(e)=>setSelectedInternalId(e.target.value)} disabled={iLoading || internalProjects.length===0}
                    style={{ padding: isSmall ? '12px 14px' : '8px 10px', fontSize: isSmall ? 16 : 14, minHeight: isSmall ? 44 : 36, border:'1px solid #cbd5e1', borderRadius:10, background:'#fff' }}
                  >
                    <option value="">Välj internprojekt</option>
                    {internalProjects.map(p => (
                      <option key={p.id} value={p.id}>{p.name || p.id}{p.active===false ? ' (inaktiv)' : ''}{p.commentRequired ? ' — kommentar krävs' : ''}</option>
                    ))}
                  </select>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    {iLoading && <span style={{ fontSize: isSmall ? 11 : 10, color:'#64748b' }}>Laddar internprojekt…</span>}
                    {iError && <span style={{ fontSize: isSmall ? 11 : 10, color:'#b91c1c' }}>{iError}</span>}
                  </div>
                </label>
              )}
              {reportType === 'absence' && (
                <label style={{ display: 'grid', gap: 4, fontSize: isSmall ? 13 : 12 }}>
                  <span>Frånvaroprojekt</span>
                  <select value={selectedAbsenceId} onChange={(e)=>setSelectedAbsenceId(e.target.value)} disabled={aLoading || absenceProjects.length===0}
                    style={{ padding: isSmall ? '12px 14px' : '8px 10px', fontSize: isSmall ? 16 : 14, minHeight: isSmall ? 44 : 36, border:'1px solid #cbd5e1', borderRadius:10, background:'#fff' }}
                  >
                    <option value="">Välj frånvaroprojekt</option>
                    {absenceProjects.map(p => (
                      <option key={p.id} value={p.id}>{p.name || p.id}{p.active===false ? ' (inaktiv)' : ''}{p.commentRequired ? ' — kommentar krävs' : ''}</option>
                    ))}
                  </select>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    {aLoading && <span style={{ fontSize: isSmall ? 11 : 10, color:'#64748b' }}>Laddar frånvaroprojekt…</span>}
                    {aError && <span style={{ fontSize: isSmall ? 11 : 10, color:'#b91c1c' }}>{aError}</span>}
                  </div>
                </label>
              )}
              <label style={{ display: 'grid', gap: 4, fontSize: isSmall ? 13 : 12 }}>
                <span>Tidkod</span>
                <select value={selectedTimecode} onChange={(e) => setSelectedTimecode(e.target.value)} disabled={tcLoading || timecodes.length === 0}
                  style={{ padding: isSmall ? '12px 14px' : '8px 10px', fontSize: isSmall ? 16 : 14, minHeight: isSmall ? 44 : 36, border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff' }}
                >
                  <option value="">Välj tidkod</option>
                  {timecodes.map(tc => {
                    const label = [tc.code, tc.name].filter(Boolean).join(' — ');
                    const extra = tc.billable == null ? '' : (tc.billable ? ' (debiterbar)' : ' (icke-debiterbar)');
                    return <option key={tc.id} value={tc.id}>{label}{extra}</option>;
                  })}
                </select>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {tcLoading && <span style={{ fontSize: isSmall ? 11 : 10, color:'#64748b' }}>Laddar tidkoder…</span>}
                  {tcError && <span role="status" aria-live="polite" style={{ fontSize: isSmall ? 11 : 10, color:'#b91c1c' }}>{tcError}</span>}
                </div>
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: isSmall ? 13 : 12 }}>
                <span>Aktivitet</span>
                <select value={selectedActivity} onChange={(e) => setSelectedActivity(e.target.value)} disabled={actLoading || activities.length === 0}
                  style={{ padding: isSmall ? '12px 14px' : '8px 10px', fontSize: isSmall ? 16 : 14, minHeight: isSmall ? 44 : 36, border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff' }}
                >
                  <option value="">Välj aktivitet</option>
                  {activities.map(a => {
                    const label = [a.code, a.name].filter(Boolean).join(' — ');
                    const extras: string[] = [];
                    if (a.billable != null) extras.push(a.billable ? 'debiterbar' : 'icke-debiterbar');
                    if (a.active === false) extras.push('inaktiv');
                    const suffix = extras.length ? ` (${extras.join(', ')})` : '';
                    return <option key={a.id} value={a.id}>{label}{suffix}</option>;
                  })}
                </select>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {actLoading && <span style={{ fontSize: isSmall ? 11 : 10, color:'#64748b' }}>Laddar aktiviteter…</span>}
                  {actError && <span role="status" aria-live="polite" style={{ fontSize: isSmall ? 11 : 10, color:'#b91c1c' }}>{actError}</span>}
                </div>
              </label>
              {reportType === 'project' && (
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontSize: isSmall ? 12 : 11, fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>Dagens projekt</span>
                    {jobsLoading && <span style={{ fontSize: isSmall ? 11 : 10, color: '#64748b' }}>Laddar…</span>}
                    {!jobsLoading && distinctProjects.length === 0 && !jobsError && <span style={{ fontSize: isSmall ? 11 : 10, color: '#64748b', fontWeight: 400 }}>Inga hittades</span>}
                    {jobsError && <span style={{ fontSize: isSmall ? 11 : 10, color: '#b91c1c', fontWeight: 500 }}>{jobsError}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
                    {distinctProjects.map(p => {
                      const labelParts = [p.order_number ? `#${p.order_number}` : (p.project_name || p.project_id)];
                      if (p.customer) labelParts.push(p.customer);
                      const label = labelParts.join(' • ');
                      const active = project && (project.includes(p.order_number || '') || project.includes(p.project_name || '') || project === p.project_id);
                      return (
                        <button key={p.project_id} type="button" onClick={() => chooseProject(p)}
                          style={{
                            flex: '0 0 auto',
                            maxWidth: 240,
                            textAlign: 'left',
                            fontSize: isSmall ? 13 : 12,
                            lineHeight: 1.2,
                            padding: isSmall ? '10px 12px' : '8px 10px',
                            border: '1px solid ' + (active ? '#16a34a' : '#cbd5e1'),
                            background: active ? '#16a34a' : '#f8fafc',
                            color: active ? '#fff' : '#0f172a',
                            borderRadius: 12,
                            boxShadow: active ? '0 2px 4px rgba(16,185,129,0.4)' : 'none',
                            minWidth: 160,
                            minHeight: 44,
                          }}
                          aria-label={`Välj projekt ${label}`}
                        >
                          <span style={{ display: 'block', fontWeight: active ? 600 : 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <label style={{ gridColumn: '1 / -1', display: 'grid', gap: 4, fontSize: isSmall ? 13 : 12 }}>
              <span>Beskrivning {requireComment ? <em style={{ color:'#b91c1c', fontStyle:'normal' }}>(krävs)</em> : null}</span>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="Vad gjordes?" style={{ padding: isSmall ? '12px 14px' : '8px 10px', fontSize: isSmall ? 16 : 14, minHeight: isSmall ? 88 : 64, border: '1px solid #cbd5e1', borderRadius: 10, resize: 'vertical' }} />
              {requireComment && !desc.trim() && (
                <span role="alert" style={{ fontSize: isSmall ? 12 : 11, color:'#b91c1c' }}>Kommentar krävs för vald typ/projekt.</span>
              )}
            </label>
          </div>
          {isXS ? (
            <div style={{ position: 'sticky', bottom: 0, background: '#fff', display: 'grid', gap: 8, borderTop: '1px dashed #e5e7eb', paddingTop: 8, paddingLeft: 12, paddingRight: 12, paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13, color: '#334155' }}>
                <span>Beräknad tid:</span>
                <strong style={{ fontSize: 16 }}>{totalHours.toFixed(2)} h</strong>
              </div>
              <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="btn--plain btn--xs" style={{ width: '100%', fontSize: 16, padding: '14px 16px', border: '1px solid #16a34a', background: canSubmit ? '#16a34a' : '#a7f3d0', color: '#fff', borderRadius: 12, boxShadow: canSubmit ? '0 4px 8px rgba(16,185,129,0.35)' : 'none', opacity: submitted === 'saving' ? 0.7 : 1, minHeight: 48 }}>
                {submitted === 'saving' ? 'Sparar…' : 'Spara'}
              </button>
              <button type="button" onClick={onClose} className="btn--plain btn--xs" style={{ fontSize: 14, padding: '10px 12px', border: '1px solid #e5e7eb', background: '#fff', borderRadius: 10, color: '#0f172a', minHeight: 44 }}>Avbryt</button>
            </div>
          ) : (
            <div style={{ position: 'sticky', bottom: 0, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTop: '1px dashed #e5e7eb', paddingTop: 8, paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: isSmall ? 13 : 12, color: '#334155' }}>
                <span>Beräknad tid:</span>
                <strong style={{ fontSize: isSmall ? 16 : 14 }}>{totalHours.toFixed(2)} h</strong>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={onClose} className="btn--plain btn--xs" style={{ fontSize: isSmall ? 14 : 12, padding: isSmall ? '10px 14px' : '8px 12px', border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, minHeight: 40 }}>Avbryt</button>
                <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="btn--plain btn--xs" style={{ fontSize: isSmall ? 14 : 12, padding: isSmall ? '10px 14px' : '8px 12px', border: '1px solid #16a34a', background: canSubmit ? '#16a34a' : '#a7f3d0', color: '#fff', borderRadius: 8, boxShadow: canSubmit ? '0 2px 4px rgba(16,185,129,0.4)' : 'none', opacity: submitted === 'saving' ? 0.7 : 1, minHeight: 40 }}>
                  {submitted === 'saving' ? 'Sparar…' : 'Spara'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
