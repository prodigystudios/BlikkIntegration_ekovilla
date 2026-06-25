"use client";
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { cn } from '@/lib/shared/cn';
import CrmModal from '@/app/crm/components/CrmModal';
import { crm } from '@/app/crm/lib/crmTokens';

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
    // Avoid bringing up the mobile keyboard on phones; only autofocus on larger screens.
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches) {
      setTimeout(() => {
        try { startRef.current?.focus(); } catch {}
      }, 50);
    }
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

  const labelText = 'text-xs font-semibold text-slate-500';
  const fieldLabel = 'grid gap-1';
  const inputCls = cn(crm.input, 'h-11 text-base sm:h-9 sm:text-sm');
  const selectCls = cn(crm.select, 'h-11 text-base sm:h-9 sm:text-sm');
  const textareaCls = 'w-full rounded-lg border border-[#dce4d8] bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 sm:text-sm';
  const helperText = 'text-[11px] text-slate-500';
  const sectionTitle = 'text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400';
  const hoursStr = totalHours.toFixed(2).replace('.', ',');

  const reportTypeHint = reportType === 'project'
    ? 'Koppla tiden till ett aktivt projekt eller ordernummer.'
    : reportType === 'internal'
      ? 'Används för internt arbete som inte ska bokas på kundprojekt.'
      : 'Välj frånvarotyp för sjukdom, ledighet eller annan frånvaro.';

  // Segmented control: a white active pill on the sage track, tinted per mode so
  // the installer sees which mode they're in without it shouting.
  const tabActiveClass: Record<'project' | 'internal' | 'absence', string> = {
    project: 'bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-200',
    internal: 'bg-white text-sky-700 shadow-sm ring-1 ring-sky-200',
    absence: 'bg-white text-amber-700 shadow-sm ring-1 ring-amber-200',
  };

  if (!open) return null;

  return (
    <CrmModal
      onClose={submitted === 'saving' ? () => {} : onClose}
      ariaLabel="Rapportera arbetstid"
      maxWidth="sm:max-w-[640px]"
      header={
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--crm-primary)' }} />
          <h2 className="text-base font-bold text-slate-900">Rapportera tid</h2>
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            Beräknat: <strong className="text-slate-900">{hoursStr} h</strong>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(crm.formButton, 'min-w-[120px]')}
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {submitted === 'saving' ? 'Sparar…' : 'Spara'}
          </button>
        </div>
      }
    >
      <div className="grid gap-5">
        {submitError && (
          <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{submitError}</div>
        )}

        {/* Report type */}
        <div className="grid gap-2">
          <div role="tablist" aria-label="Rapporttyp" className="grid grid-cols-3 gap-1 rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] p-1">
            {([
              { key: 'project', label: 'Projekt' },
              { key: 'internal', label: 'Intern' },
              { key: 'absence', label: 'Frånvaro' },
            ] as const).map(opt => (
              <button
                key={opt.key}
                type="button"
                role="tab"
                aria-selected={reportType === opt.key}
                onClick={() => setReportType(opt.key)}
                className={cn(
                  'h-10 rounded-lg text-sm font-semibold transition sm:h-9',
                  reportType === opt.key ? tabActiveClass[opt.key] : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className={helperText}>{reportTypeHint}</p>
        </div>

        {/* Time */}
        <div className="grid gap-2.5">
          <p className={sectionTitle}>Tid</p>
          <label className={fieldLabel}>
            <span className={labelText}>Datum</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className={fieldLabel}>
              <span className={labelText}>Start</span>
              <input
                ref={startRef}
                type="time"
                value={start}
                onChange={e => setStart(e.target.value)}
                placeholder="07:00"
                className={cn(inputCls, validationError ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-400/20' : '')}
              />
            </label>
            <label className={fieldLabel}>
              <span className={labelText}>Slut</span>
              <input
                type="time"
                value={end}
                onChange={e => setEnd(e.target.value)}
                placeholder="16:00"
                className={cn(inputCls, validationError ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-400/20' : '')}
              />
            </label>
            <label className={fieldLabel}>
              <span className={labelText}>Rast (min)</span>
              <input inputMode="numeric" pattern="[0-9]*" value={breakMin} onChange={e => setBreakMin(e.target.value)} placeholder="0" className={inputCls} />
            </label>
          </div>
          {validationError ? (
            <div role="alert" className="text-xs text-rose-700">{validationError}</div>
          ) : (
            <div className="flex items-center justify-end gap-1.5 text-sm">
              <span className="text-slate-500">Beräknat</span>
              <strong className="text-base font-bold text-emerald-700">{hoursStr} h</strong>
            </div>
          )}
        </div>

        {/* Connection */}
        <div className="grid gap-2.5">
          <p className={sectionTitle}>Koppling</p>
          {reportType === 'project' && (
            <label className={fieldLabel}>
              <span className={labelText}>Projekt / ordernummer</span>
              <input value={project} onChange={e => setProject(e.target.value)} placeholder="#1234 eller projektnamn" className={inputCls} />
            </label>
          )}
          {reportType === 'internal' && (
            <label className={fieldLabel}>
              <span className={labelText}>Internprojekt</span>
              <select value={selectedInternalId} onChange={(e) => setSelectedInternalId(e.target.value)} disabled={iLoading || internalProjects.length === 0} className={selectCls}>
                <option value="">Välj internprojekt</option>
                {internalProjects.map(p => (
                  <option key={p.id} value={p.id}>{p.name || p.id}{p.active === false ? ' (inaktiv)' : ''}{p.commentRequired ? ' — kommentar krävs' : ''}</option>
                ))}
              </select>
              {iLoading && <span className={helperText}>Laddar internprojekt…</span>}
              {iError && <span className="text-[11px] text-rose-700">{iError}</span>}
            </label>
          )}
          {reportType === 'absence' && (
            <label className={fieldLabel}>
              <span className={labelText}>Frånvaroprojekt</span>
              <select value={selectedAbsenceId} onChange={(e) => setSelectedAbsenceId(e.target.value)} disabled={aLoading || absenceProjects.length === 0} className={selectCls}>
                <option value="">Välj frånvaroprojekt</option>
                {absenceProjects.map(p => (
                  <option key={p.id} value={p.id}>{p.name || p.id}{p.active === false ? ' (inaktiv)' : ''}{p.commentRequired ? ' — kommentar krävs' : ''}</option>
                ))}
              </select>
              {aLoading && <span className={helperText}>Laddar frånvaroprojekt…</span>}
              {aError && <span className="text-[11px] text-rose-700">{aError}</span>}
            </label>
          )}

          {reportType === 'project' && (
            <div className="grid gap-1.5 rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] p-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                <span>Dagens jobb</span>
                {jobsLoading && <span className="font-normal text-slate-400">Laddar…</span>}
                {!jobsLoading && distinctProjects.length === 0 && !jobsError && <span className="font-normal text-slate-400">Inga hittades</span>}
                {jobsError && <span className="font-medium text-rose-700">{jobsError}</span>}
              </div>
              {distinctProjects.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1 [webkit-overflow-scrolling:touch]">
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
                        aria-label={`Välj projekt ${label}`}
                        className={cn(
                          'h-10 min-w-[180px] max-w-[280px] flex-none rounded-lg border px-3 text-left text-[13px] leading-tight transition',
                          active
                            ? 'border-emerald-600 text-white'
                            : 'border-[#dce4d8] bg-white text-slate-800 hover:border-emerald-300 hover:bg-emerald-50/40'
                        )}
                        style={active ? { backgroundColor: 'var(--crm-primary)' } : undefined}
                      >
                        <span className={cn('block truncate', active ? 'font-semibold' : 'font-medium')}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className={fieldLabel}>
              <span className={labelText}>Tidkod</span>
              <select value={selectedTimecode} onChange={(e) => setSelectedTimecode(e.target.value)} disabled={tcLoading || timecodes.length === 0} className={selectCls}>
                <option value="">Välj tidkod</option>
                {timecodes.map(tc => {
                  const label = [tc.code, tc.name].filter(Boolean).join(' — ');
                  const extra = tc.billable == null ? '' : (tc.billable ? ' (debiterbar)' : ' (icke-debiterbar)');
                  return <option key={tc.id} value={tc.id}>{label}{extra}</option>;
                })}
              </select>
              {tcLoading && <span className={helperText}>Laddar tidkoder…</span>}
              {tcError && <span role="status" aria-live="polite" className="text-[11px] text-rose-700">{tcError}</span>}
            </label>
            <label className={fieldLabel}>
              <span className={labelText}>Aktivitet</span>
              <select value={selectedActivity} onChange={(e) => setSelectedActivity(e.target.value)} disabled={actLoading || activities.length === 0} className={selectCls}>
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
              {actLoading && <span className={helperText}>Laddar aktiviteter…</span>}
              {actError && <span role="status" aria-live="polite" className="text-[11px] text-rose-700">{actError}</span>}
            </label>
          </div>
        </div>

        {/* Description */}
        <div className="grid gap-2">
          <p className={sectionTitle}>Beskrivning</p>
          <label className={fieldLabel}>
            <span className={labelText}>Vad gjordes? {requireComment ? <em className="not-italic text-rose-700">(krävs)</em> : null}</span>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="Kort beskrivning av arbetet" className={textareaCls} />
            {requireComment && !desc.trim() && (
              <span role="alert" className="text-[11px] text-rose-700">Kommentar krävs för vald typ/projekt.</span>
            )}
          </label>
        </div>

        {/* Travel (optional) */}
        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => setShowTravel(v => !v)}
            aria-expanded={showTravel}
            className="flex h-11 w-full items-center justify-between rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] px-3 text-sm font-semibold text-slate-700 transition hover:border-emerald-300 sm:h-10"
          >
            <span>Reserapport (valfritt)</span>
            <span aria-hidden className="text-slate-400">{showTravel ? '▾' : '▸'}</span>
          </button>
          {showTravel && (
            <div className="grid gap-3 rounded-xl border border-[#e0e8dc] bg-[#f9fbf7] p-3">
              <label className={fieldLabel}>
                <span className={labelText}>Plats / sträcka</span>
                <input value={travelPlace} onChange={(e) => setTravelPlace(e.target.value)} placeholder="Piteå–Luleå–Piteå" className={inputCls} />
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <label className={fieldLabel}>
                  <span className={labelText}>Km (faktiskt)</span>
                  <input type="number" min={0} value={travelDistance} onChange={(e) => setTravelDistance(e.target.value)} placeholder="100" className={inputCls} />
                </label>
                <label className={fieldLabel}>
                  <span className={labelText}>Km (debiterbart)</span>
                  <input type="number" min={0} value={travelInvoiceableDistance} onChange={(e) => setTravelInvoiceableDistance(e.target.value)} placeholder="120" className={inputCls} />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={travelToSalary} onChange={(e) => setTravelToSalary(e.target.checked)} className="h-4 w-4 rounded border-[#dce4d8] text-emerald-600 focus:ring-emerald-500/30" />
                <span>Till lön</span>
              </label>
              <div className="grid gap-2.5">
                <span className={labelText}>Företagsbil (valfritt)</span>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <label className={fieldLabel}>
                    <span className={labelText}>Bil-ID</span>
                    <input value={companyCarId} onChange={(e) => setCompanyCarId(e.target.value)} placeholder="1" className={inputCls} />
                  </label>
                  <label className={fieldLabel}>
                    <span className={labelText}>Mätarstart</span>
                    <input type="number" min={0} value={tripStart} onChange={(e) => setTripStart(e.target.value)} placeholder="15000" className={inputCls} />
                  </label>
                  <label className={fieldLabel}>
                    <span className={labelText}>Mätarslut</span>
                    <input type="number" min={0} value={tripEnd} onChange={(e) => setTripEnd(e.target.value)} placeholder="15100" className={inputCls} />
                  </label>
                </div>
                <label className={fieldLabel}>
                  <span className={labelText}>Adress start</span>
                  <input value={addressStart} onChange={(e) => setAddressStart(e.target.value)} placeholder="Generalgatan 1" className={inputCls} />
                </label>
                <label className={fieldLabel}>
                  <span className={labelText}>Adress mål</span>
                  <input value={addressGoal} onChange={(e) => setAddressGoal(e.target.value)} placeholder="Generalgatan 2" className={inputCls} />
                </label>
                <label className={fieldLabel}>
                  <span className={labelText}>Adress slut</span>
                  <input value={addressEnd} onChange={(e) => setAddressEnd(e.target.value)} placeholder="Generalgatan 1" className={inputCls} />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </CrmModal>
  );
}
