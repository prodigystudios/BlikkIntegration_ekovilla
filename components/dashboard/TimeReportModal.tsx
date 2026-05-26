"use client";
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { cn } from '@/lib/shared/cn';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';

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
  }) => Promise<any> | boolean | void;
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
  // Optional travel report initial values
  initialTravelPlace?: string | null;
  initialTravelDistance?: number | string | null;
  initialTravelInvoiceableDistance?: number | string | null;
  initialTravelToSalary?: boolean | null;
  initialCompanyCarId?: number | string | null;
  initialTripStart?: number | string | null;
  initialTripEnd?: number | string | null;
  initialAddressStart?: string | null;
  initialAddressGoal?: string | null;
  initialAddressEnd?: string | null;
}

export default function TimeReportModal({ open, onClose, onSubmit, initialProject, initialProjectId, initialDate, editId: propEditId, initialStart, initialEnd, initialBreakMinutes, initialDescription, initialTimecodeId, initialActivityId, initialReportType, initialInternalProjectId, initialAbsenceProjectId, initialTravelPlace, initialTravelDistance, initialTravelInvoiceableDistance, initialTravelToSalary, initialCompanyCarId, initialTripStart, initialTripEnd, initialAddressStart, initialAddressGoal, initialAddressEnd }: TimeReportModalProps) {
  const [isSmall, setIsSmall] = useState(false); // <= 640px
  const [isXS, setIsXS] = useState(false); // <= 420px
  const startRef = useRef<HTMLInputElement | null>(null);
  const [date, setDate] = useState<string>('');
  const [start, setStart] = useState<string>('');
  const [end, setEnd] = useState<string>('');
  const [breakMin, setBreakMin] = useState<string>('0');
  const [project, setProject] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [desc, setDesc] = useState<string>('');
  const [submitted, setSubmitted] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
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

  // Travel report state (collapsible section)
  const [showTravel, setShowTravel] = useState(false);
  const [travelPlace, setTravelPlace] = useState<string>('');
  const [travelDistance, setTravelDistance] = useState<string>('');
  const [travelInvoiceableDistance, setTravelInvoiceableDistance] = useState<string>('');
  const [travelToSalary, setTravelToSalary] = useState<boolean>(false);
  const [companyCarId, setCompanyCarId] = useState<string>('');
  const [tripStart, setTripStart] = useState<string>('');
  const [tripEnd, setTripEnd] = useState<string>('');
  const [addressStart, setAddressStart] = useState<string>('');
  const [addressGoal, setAddressGoal] = useState<string>('');
  const [addressEnd, setAddressEnd] = useState<string>('');

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
    // Prefill travel values if provided
    setTravelPlace(initialTravelPlace ? String(initialTravelPlace) : '');
    setTravelDistance(initialTravelDistance != null ? String(initialTravelDistance) : '');
    setTravelInvoiceableDistance(initialTravelInvoiceableDistance != null ? String(initialTravelInvoiceableDistance) : '');
    setTravelToSalary(!!initialTravelToSalary);
    setCompanyCarId(initialCompanyCarId != null ? String(initialCompanyCarId) : '');
    setTripStart(initialTripStart != null ? String(initialTripStart) : '');
    setTripEnd(initialTripEnd != null ? String(initialTripEnd) : '');
    setAddressStart(initialAddressStart || '');
    setAddressGoal(initialAddressGoal || '');
    setAddressEnd(initialAddressEnd || '');
    // Avoid bringing up mobile keyboard on very small screens
    if (!isXS) {
      setTimeout(() => {
        try { startRef.current?.focus(); } catch {}
      }, 50);
    }
  }, [open, isXS, initialProject, initialProjectId, initialDate, initialStart, initialEnd, initialBreakMinutes, initialDescription, initialTimecodeId, initialActivityId, initialReportType, initialInternalProjectId, initialAbsenceProjectId]);

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
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitError(null);
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
    // Attach optional travel report if any value present
    const d = Number(travelDistance);
    const di = Number(travelInvoiceableDistance);
    const csId = Number(companyCarId);
    const ts = Number(tripStart);
    const te = Number(tripEnd);
    const hasCompanyCar = Number.isFinite(csId) && csId > 0;
    const hasTravel = (travelPlace.trim().length > 0) || Number.isFinite(d) || Number.isFinite(di) || travelToSalary || hasCompanyCar || !!addressStart || !!addressGoal || !!addressEnd;
    if (hasTravel) {
      (payload as any).travelReport = {
        place: travelPlace || undefined,
        distance: Number.isFinite(d) ? d : undefined,
        invoiceableDistance: Number.isFinite(di) ? di : undefined,
        toSalary: !!travelToSalary,
        companyCar: hasCompanyCar ? {
          id: csId,
          tripStart: Number.isFinite(ts) ? ts : undefined,
          tripEnd: Number.isFinite(te) ? te : undefined,
          addressStart: addressStart || undefined,
          addressGoal: addressGoal || undefined,
          addressEnd: addressEnd || undefined,
        } : undefined,
      };
    }
    try {
      // Allow caller to return a Promise<boolean> or just void. Await if promise-like.
      const result = onSubmit ? onSubmit(payload as any) : undefined;
      if (result && typeof (result as Promise<any>).then === 'function') {
        const res = await (result as Promise<any>);
        // If the caller returns falsy / indicates failure, treat as error
        if (res === false) {
          setSubmitted('idle');
          setSubmitError('Kunde inte spara. Försök igen.');
          return;
        }
      }
      // success
      setSubmitted('saved');
      setTimeout(() => {
        setSubmitted('idle');
        onClose();
      }, 500);
    } catch (err: any) {
      setSubmitted('idle');
      setSubmitError(err?.message || 'Fel vid sparande.');
    }
  };

  const chooseProject = useCallback((p: { project_id: string; project_name: string | null; order_number: string | null }) => {
    // Prefer order number; else project name; fallback to id
    const val = p.order_number ? `#${p.order_number}` : (p.project_name || p.project_id);
    setProject(val);
    setSelectedProjectId(p.project_id);
  }, []);

  const modalFieldLabelClass = cn('grid gap-1 text-slate-700', isSmall ? 'text-[13px]' : 'text-xs');
  const modalInputClass = cn(isSmall ? 'min-h-11 px-3.5 py-3 text-base' : 'min-h-9 rounded-[10px] px-2.5 py-2 text-sm');
  const modalSelectClass = cn(
    'w-full rounded-xl border border-ui-border bg-white text-ui-text-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/20',
    isSmall ? 'min-h-11 px-3.5 py-3 text-base' : 'min-h-9 rounded-[10px] px-2.5 py-2 text-sm',
  );
  const modalHelperTextClass = cn(isSmall ? 'text-[11px]' : 'text-[10px]');
  const modalSectionClass = cn(
    'grid border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] shadow-[0_10px_24px_rgba(15,23,42,0.05)]',
    isSmall ? 'gap-3 rounded-[18px] p-3.5' : 'gap-3.5 rounded-[20px] p-4'
  );
  const modalSectionTitleClass = cn('font-bold text-slate-900', isSmall ? 'text-[13px]' : 'text-[13.5px]');
  const modalSectionHintClass = cn('leading-[1.45] text-slate-500', isSmall ? 'text-[11px]' : 'text-[11.5px]');
  const modalSummaryPillClass = cn(
    'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]',
    isSmall ? 'px-2.5 py-1 text-[11px] font-semibold' : 'px-2.5 py-1 text-[11px] font-semibold'
  );
  const reportTypeMeta = reportType === 'project'
    ? {
        hint: 'Koppla tiden till ett aktivt projekt eller ordernummer.',
        pill: 'Projektläge',
        activeClass: 'bg-green-600 text-white shadow-[0_4px_10px_rgba(22,163,74,0.18)]',
      }
    : reportType === 'internal'
      ? {
          hint: 'Används för internt arbete som inte ska bokas på kundprojekt.',
          pill: 'Internt arbete',
          activeClass: 'bg-blue-600 text-white shadow-[0_4px_10px_rgba(37,99,235,0.18)]',
        }
      : {
          hint: 'Välj frånvarotyp för sjukdom, ledighet eller annan frånvaro.',
          pill: 'Frånvaro',
          activeClass: 'bg-amber-500 text-slate-950 shadow-[0_4px_10px_rgba(245,158,11,0.22)]',
        };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Rapportera arbetstid"
      onClick={onClose}
      className={cn(
        'fixed inset-0 z-[1000] flex justify-center bg-slate-900/35',
        isXS ? 'items-stretch p-0' : 'items-center p-4'
      )}
      style={{ touchAction: 'manipulation' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className={cn(
          'relative flex flex-col border border-slate-200 bg-white',
          isXS ? 'h-[100dvh] w-full rounded-none shadow-none' : 'w-full max-w-[700px] rounded-[14px] shadow-[0_20px_40px_rgba(0,0,0,0.15)]'
        )}
        style={{ maxHeight: isXS ? '100dvh' : '85vh', height: isXS ? '100dvh' : 'auto' }}
      >
        <div
          className={cn(
            'sticky top-0 z-[5] flex items-center justify-between border-b border-slate-200 bg-white',
            isSmall ? 'px-3 py-2.5' : 'px-3.5 py-3'
          )}
          style={{ paddingTop: isXS ? 'max(10px, env(safe-area-inset-top))' : undefined }}
        >
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-full border-2 border-green-200 bg-green-500" />
            <div className="text-base font-bold text-slate-900">Rapportera tid</div>
          </div>
          <Button
            onClick={submitted === 'saving' ? undefined : onClose}
            aria-label="Stäng"
            variant="secondary"
            size={isSmall ? 'md' : 'sm'}
            disabled={submitted === 'saving'}
            className={cn(isSmall ? 'min-h-11 px-3.5' : 'rounded-[10px] px-3')}
          >
            Stäng
          </Button>
        </div>
        <div className={cn('relative flex-1 overflow-y-auto [overscroll-behavior:contain] [webkit-overflow-scrolling:touch]', isSmall ? 'grid gap-3 p-3 pb-3' : 'grid gap-3.5 p-3.5 pb-3')}>
          {/* Submission overlay */}
          {submitted === 'saving' && (
            <div aria-hidden className="absolute inset-0 z-30 flex items-center justify-center bg-white/60 p-4">
              <div className="flex flex-col items-center gap-2.5">
                <span className="spinner dark spin h-10 w-10" aria-hidden />
                <div className="text-[13px] text-slate-900">Sparar…</div>
              </div>
            </div>
          )}
          <section className={modalSectionClass}>
            <div className="flex flex-wrap items-start justify-between gap-2.5">
              <div className="grid gap-1">
                <strong className={modalSectionTitleClass}>1. Grunduppgifter</strong>
                <span className={modalSectionHintClass}>Välj rapporttyp och fyll i tid först. Resten av formuläret anpassar sig efter valet.</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={modalSummaryPillClass}>Typ: {reportType === 'project' ? 'Projekt' : reportType === 'internal' ? 'Intern' : 'Frånvaro'}</span>
                <span className={modalSummaryPillClass}>Beräknat: {totalHours.toFixed(2)} h</span>
              </div>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className={cn('text-slate-700', isSmall ? 'text-[13px]' : 'text-xs')}>Typ:</span>
                <div role="tablist" aria-label="Rapporttyp" className="inline-flex overflow-hidden rounded-[12px] border border-slate-300 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                  {([
                    { key:'project', label:'Projekt' },
                    { key:'internal', label:'Intern' },
                    { key:'absence', label:'Frånvaro' },
                  ] as const).map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      role="tab"
                      aria-selected={reportType===opt.key}
                      onClick={()=>setReportType(opt.key)}
                      className={cn(
                        'rounded-none border-r border-slate-300 font-medium first:rounded-l-[11px] last:rounded-r-[11px] last:border-r-0 transition-[background-color,color,box-shadow]',
                        isSmall ? 'px-3 py-2 text-[13px]' : 'px-3 py-2 text-xs',
                        reportType===opt.key
                          ? opt.key === 'project'
                            ? 'bg-green-600 text-white shadow-[0_4px_10px_rgba(22,163,74,0.18)]'
                            : opt.key === 'internal'
                              ? 'bg-blue-600 text-white shadow-[0_4px_10px_rgba(37,99,235,0.18)]'
                              : 'bg-amber-500 text-slate-950 shadow-[0_4px_10px_rgba(245,158,11,0.22)]'
                          : 'bg-white text-slate-900 hover:bg-slate-50'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn(modalSummaryPillClass, reportTypeMeta.activeClass)}>{reportTypeMeta.pill}</span>
                <span className={modalSectionHintClass}>{reportTypeMeta.hint}</span>
              </div>

              <div className={cn('grid items-start', isSmall ? 'grid-cols-1 gap-2.5' : 'grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.72fr)] gap-2.5')}>
                <label className={modalFieldLabelClass}>
                  <span>Datum</span>
                  <Input type="date" value={date} onChange={e => setDate(e.target.value)} className={modalInputClass} />
                </label>
                <div className={cn('grid', isXS ? 'grid-cols-1 gap-2' : 'grid-cols-2 gap-2.5')}>
                  <label className={modalFieldLabelClass}>
                    <span>Start</span>
                    <Input
                      ref={startRef}
                      type="time"
                      value={start}
                      onChange={e => setStart(e.target.value)}
                      placeholder="07:00"
                      className={cn(modalInputClass, validationError ? 'border-red-200 focus-visible:ring-red-200/40' : '')}
                    />
                  </label>
                  <label className={modalFieldLabelClass}>
                    <span>Slut</span>
                    <Input
                      type="time"
                      value={end}
                      onChange={e => setEnd(e.target.value)}
                      placeholder="16:00"
                      className={cn(modalInputClass, validationError ? 'border-red-200 focus-visible:ring-red-200/40' : '')}
                    />
                  </label>
                </div>
                <label className={modalFieldLabelClass}>
                  <span>Rast (minuter)</span>
                  <Input inputMode="numeric" pattern="[0-9]*" value={breakMin} onChange={e => setBreakMin(e.target.value)} placeholder="0" className={modalInputClass} />
                </label>
              </div>
              {validationError && (
                <div role="alert" className={cn('text-red-700', isSmall ? 'text-xs' : 'text-[11px]')}>{validationError}</div>
              )}
            </div>
          </section>

          <section className={modalSectionClass}>
            <div className="grid gap-1">
              <strong className={modalSectionTitleClass}>2. Koppla rapporten</strong>
              <span className={modalSectionHintClass}>Välj projekt eller intern/frånvarotyp och säkra därefter tidkod samt aktivitet.</span>
            </div>
            <div className={cn('grid items-start', isSmall ? 'grid-cols-1 gap-2.5' : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3')}>
              <div className="grid gap-1.5">
              {reportType === 'project' && (
                <label className={modalFieldLabelClass}>
                  <span>Projekt / Ordernummer</span>
                  <Input value={project} onChange={e => setProject(e.target.value)} placeholder="#1234 eller projektnamn" className={modalInputClass} />
                </label>
              )}
              {reportType === 'internal' && (
                <label className={modalFieldLabelClass}>
                  <span>Internprojekt</span>
                  <select value={selectedInternalId} onChange={(e)=>setSelectedInternalId(e.target.value)} disabled={iLoading || internalProjects.length===0} className={modalSelectClass}>
                    <option value="">Välj internprojekt</option>
                    {internalProjects.map(p => (
                      <option key={p.id} value={p.id}>{p.name || p.id}{p.active===false ? ' (inaktiv)' : ''}{p.commentRequired ? ' — kommentar krävs' : ''}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    {iLoading && <span className={cn(modalHelperTextClass, 'text-slate-500')}>Laddar internprojekt…</span>}
                    {iError && <span className={cn(modalHelperTextClass, 'text-red-700')}>{iError}</span>}
                  </div>
                </label>
              )}
              {reportType === 'absence' && (
                <label className={modalFieldLabelClass}>
                  <span>Frånvaroprojekt</span>
                  <select value={selectedAbsenceId} onChange={(e)=>setSelectedAbsenceId(e.target.value)} disabled={aLoading || absenceProjects.length===0} className={modalSelectClass}>
                    <option value="">Välj frånvaroprojekt</option>
                    {absenceProjects.map(p => (
                      <option key={p.id} value={p.id}>{p.name || p.id}{p.active===false ? ' (inaktiv)' : ''}{p.commentRequired ? ' — kommentar krävs' : ''}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    {aLoading && <span className={cn(modalHelperTextClass, 'text-slate-500')}>Laddar frånvaroprojekt…</span>}
                    {aError && <span className={cn(modalHelperTextClass, 'text-red-700')}>{aError}</span>}
                  </div>
                </label>
              )}
              </div>
              <div className="grid gap-1.5">
              <label className={modalFieldLabelClass}>
                <span>Tidkod</span>
                <select value={selectedTimecode} onChange={(e) => setSelectedTimecode(e.target.value)} disabled={tcLoading || timecodes.length === 0} className={modalSelectClass}>
                  <option value="">Välj tidkod</option>
                  {timecodes.map(tc => {
                    const label = [tc.code, tc.name].filter(Boolean).join(' — ');
                    const extra = tc.billable == null ? '' : (tc.billable ? ' (debiterbar)' : ' (icke-debiterbar)');
                    return <option key={tc.id} value={tc.id}>{label}{extra}</option>;
                  })}
                </select>
                <div className="flex items-center gap-2">
                  {tcLoading && <span className={cn(modalHelperTextClass, 'text-slate-500')}>Laddar tidkoder…</span>}
                  {tcError && <span role="status" aria-live="polite" className={cn(modalHelperTextClass, 'text-red-700')}>{tcError}</span>}
                </div>
              </label>
              <label className={modalFieldLabelClass}>
                <span>Aktivitet</span>
                <select value={selectedActivity} onChange={(e) => setSelectedActivity(e.target.value)} disabled={actLoading || activities.length === 0} className={modalSelectClass}>
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
                <div className="flex items-center gap-2">
                  {actLoading && <span className={cn(modalHelperTextClass, 'text-slate-500')}>Laddar aktiviteter…</span>}
                  {actError && <span role="status" aria-live="polite" className={cn(modalHelperTextClass, 'text-red-700')}>{actError}</span>}
                </div>
              </label>
            </div>
            </div>
            {reportType === 'project' && (
              <div className="grid gap-1.5 rounded-[16px] border border-dashed border-slate-200 bg-slate-50/70 p-3">
                <div className={cn('flex items-center gap-1.5 font-semibold text-slate-900', isSmall ? 'text-xs' : 'text-[11px]')}>
                  <span>Dagens projekt</span>
                  {jobsLoading && <span className={cn(modalHelperTextClass, 'font-normal text-slate-500')}>Laddar…</span>}
                  {!jobsLoading && distinctProjects.length === 0 && !jobsError && <span className={cn(modalHelperTextClass, 'font-normal text-slate-500')}>Inga hittades</span>}
                  {jobsError && <span className={cn(modalHelperTextClass, 'font-medium text-red-700')}>{jobsError}</span>}
                </div>
                <div className={cn('flex overflow-x-auto pb-1 [webkit-overflow-scrolling:touch]', isSmall ? 'gap-2' : 'gap-2.5')}>
                  {distinctProjects.map(p => {
                    const labelParts = [p.order_number ? `#${p.order_number}` : (p.project_name || p.project_id)];
                    if (p.customer) labelParts.push(p.customer);
                    const label = labelParts.join(' • ');
                    const active = project && (project.includes(p.order_number || '') || project.includes(p.project_name || '') || project === p.project_id);
                    return (
                      <button
                        key={p.project_id}
                        type="button"
                        onClick={() => chooseProject(p)}
                        className={cn(
                          'min-h-11 min-w-[220px] max-w-[320px] flex-none rounded-[14px] border text-left leading-tight transition-[transform,border-color,box-shadow,background-color]',
                          isSmall ? 'px-3 py-2.5 text-[13px]' : 'px-3 py-2.5 text-xs',
                          active
                            ? 'border-green-600 bg-green-600 text-white shadow-[0_10px_18px_rgba(16,185,129,0.24)]'
                            : 'border-slate-300 bg-white text-slate-900 shadow-[0_6px_14px_rgba(15,23,42,0.05)] hover:-translate-y-0.5 hover:border-green-200 hover:shadow-[0_10px_18px_rgba(16,185,129,0.10)]'
                        )}
                        aria-label={`Välj projekt ${label}`}
                      >
                        <span className={cn('block truncate', active ? 'font-semibold' : 'font-medium')}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className={modalSectionClass}>
            <div className="grid gap-1">
              <strong className={modalSectionTitleClass}>3. Beskriv arbetet</strong>
              <span className={modalSectionHintClass}>Skriv kort vad som gjordes. Kommentaren blir obligatorisk när vald typ eller projekt kräver det.</span>
            </div>
            <label className={modalFieldLabelClass}>
              <span>Beskrivning {requireComment ? <em className="not-italic text-red-700">(krävs)</em> : null}</span>
              <Textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="Vad gjordes?" className={cn('min-h-0', isSmall ? 'min-h-[88px] px-3.5 py-3 text-base' : 'min-h-16 rounded-[10px] px-2.5 py-2 text-sm')} />
              {requireComment && !desc.trim() && (
                <span role="alert" className={cn(isSmall ? 'text-xs' : 'text-[11px]', 'text-red-700')}>Kommentar krävs för vald typ/projekt.</span>
              )}
            </label>
          </section>
          {/* Travel section placed at bottom, expands downward above the footer */}
          <div className={modalSectionClass}>
            <div className="grid gap-1">
              <strong className={modalSectionTitleClass}>4. Reserapport</strong>
              <span className={modalSectionHintClass}>Valfritt. Fyll bara i om resan ska rapporteras tillsammans med tiden.</span>
            </div>
            <button
              type="button"
              onClick={() => setShowTravel(v => !v)}
              aria-expanded={showTravel}
              className={cn(
                'flex w-full items-center justify-between rounded-[12px] border border-slate-300 bg-white text-slate-900 shadow-[0_6px_14px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow,background-color] hover:border-green-200 hover:bg-green-50/40 hover:shadow-[0_10px_18px_rgba(16,185,129,0.08)]',
                isSmall ? 'px-3.5 py-3' : 'px-3 py-2.5'
              )}
            >
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 rounded-full border-2 border-green-200 bg-green-500" />
                <strong className={cn(isSmall ? 'text-sm' : 'text-[13px]')}>Reserapport (valfritt)</strong>
              </span>
              <span aria-hidden className={cn(isSmall ? 'text-lg' : 'text-base')}>{showTravel ? '▾' : '▸'}</span>
            </button>
            {showTravel && (
              <div className={cn('grid rounded-[16px] border border-dashed border-slate-200 bg-slate-50/70', isSmall ? 'gap-3 p-3' : 'gap-2.5 p-3')}>
                <label className={modalFieldLabelClass}>
                  <span>Plats / Sträcka</span>
                  <Input value={travelPlace} onChange={(e)=>setTravelPlace(e.target.value)} placeholder="Piteå–Luleå–Piteå" className={modalInputClass} />
                </label>
                <div className={cn('grid', isXS ? 'grid-cols-1 gap-2' : 'grid-cols-2 gap-2.5')}>
                  <label className={modalFieldLabelClass}>
                    <span>Km (faktiskt)</span>
                    <Input type="number" min={0} value={travelDistance} onChange={(e)=>setTravelDistance(e.target.value)} placeholder="100" className={modalInputClass} />
                  </label>
                  <label className={modalFieldLabelClass}>
                    <span>Km (debiterbart)</span>
                    <Input type="number" min={0} value={travelInvoiceableDistance} onChange={(e)=>setTravelInvoiceableDistance(e.target.value)} placeholder="120" className={modalInputClass} />
                  </label>
                </div>
                <label className={cn('inline-flex items-center gap-2 text-slate-700', isSmall ? 'text-[13px]' : 'text-xs')}>
                  <input type="checkbox" checked={travelToSalary} onChange={(e)=>setTravelToSalary(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-200" />
                  <span>Till lön</span>
                </label>
                <div className="grid gap-2">
                  <span className={cn(isSmall ? 'text-xs' : 'text-[11px]', 'text-slate-500')}>Företagsbil (valfritt)</span>
                  <div className={cn('grid', isXS ? 'grid-cols-1 gap-2' : 'grid-cols-2 gap-2.5')}>
                    <label className={modalFieldLabelClass}>
                      <span>Bil-ID</span>
                      <Input value={companyCarId} onChange={(e)=>setCompanyCarId(e.target.value)} placeholder="1" className={modalInputClass} />
                    </label>
                    <label className={modalFieldLabelClass}>
                      <span>Mätarstart</span>
                      <Input type="number" min={0} value={tripStart} onChange={(e)=>setTripStart(e.target.value)} placeholder="15000" className={modalInputClass} />
                    </label>
                    <label className={modalFieldLabelClass}>
                      <span>Mätarslut</span>
                      <Input type="number" min={0} value={tripEnd} onChange={(e)=>setTripEnd(e.target.value)} placeholder="15100" className={modalInputClass} />
                    </label>
                  </div>
                  <label className={modalFieldLabelClass}>
                    <span>Adress start</span>
                    <Input value={addressStart} onChange={(e)=>setAddressStart(e.target.value)} placeholder="Generalgatan 1" className={modalInputClass} />
                  </label>
                  <label className={modalFieldLabelClass}>
                    <span>Adress mål</span>
                    <Input value={addressGoal} onChange={(e)=>setAddressGoal(e.target.value)} placeholder="Generalgatan 2" className={modalInputClass} />
                  </label>
                  <label className={modalFieldLabelClass}>
                    <span>Adress slut</span>
                    <Input value={addressEnd} onChange={(e)=>setAddressEnd(e.target.value)} placeholder="Generalgatan 1" className={modalInputClass} />
                  </label>
                </div>
              </div>
            )}
          </div>
          {isXS ? (
            <div className="relative grid gap-2 border-t border-dashed border-slate-200 bg-white px-3 pt-2" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
              <div className="flex items-center justify-between gap-2.5 text-[13px] text-slate-700">
                <span>Beräknad tid:</span>
                <strong className="text-base text-slate-900">{totalHours.toFixed(2)} h</strong>
              </div>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                fullWidth
                size="lg"
                className={cn('min-h-12 rounded-xl border-green-600 text-base text-white', canSubmit ? 'bg-green-600 shadow-[0_4px_8px_rgba(16,185,129,0.35)] hover:bg-green-700' : 'bg-green-200')}
              >
                {submitted === 'saving' ? <span className="inline-flex items-center gap-2"><span className="spinner spin h-4 w-4" aria-hidden style={{ borderTopColor:'#fff' }} /> Sparar…</span> : 'Spara'}
              </Button>
              <Button type="button" onClick={onClose} variant="secondary" size="lg" className="min-h-11 rounded-[10px] text-sm">Avbryt</Button>
            </div>
          ) : (
            <div className="relative flex items-center justify-between gap-2.5 border-t border-dashed border-slate-200 bg-white pt-2" style={{ paddingBottom: 'max(15px, env(safe-area-inset-bottom))' }}>
              <div className={cn('flex items-center gap-2.5 text-slate-700', isSmall ? 'text-[13px]' : 'text-xs')}>
                <span>Beräknad tid:</span>
                <strong className={cn('text-slate-900', isSmall ? 'text-base' : 'text-sm')}>{totalHours.toFixed(2)} h</strong>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={onClose} variant="secondary" size={isSmall ? 'md' : 'sm'} className={cn(isSmall ? 'min-h-10 px-3.5 text-sm' : 'rounded-lg px-3')}>Avbryt</Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  size={isSmall ? 'md' : 'sm'}
                  className={cn(
                    'border-green-600 text-white',
                    isSmall ? 'min-h-10 px-3.5 text-sm' : 'rounded-lg px-3',
                    canSubmit ? 'bg-green-600 shadow-[0_2px_4px_rgba(16,185,129,0.4)] hover:bg-green-700' : 'bg-green-200'
                  )}
                >
                  {submitted === 'saving' ? <span className="inline-flex items-center gap-2"><span className="spinner spin h-4 w-4" aria-hidden style={{ borderTopColor:'#fff' }} /> Sparar…</span> : 'Spara'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
