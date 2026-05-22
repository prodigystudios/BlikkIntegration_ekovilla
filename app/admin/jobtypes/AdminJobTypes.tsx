"use client";
import React, { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import LoadingState from '../../../components/ui/LoadingState';
import SectionCard from '../../../components/ui/SectionCard';

type Row = { job_type: string; color_hex: string };

const DEFAULT_JOB_TYPES = ['Ekovilla', 'Vitull', 'Leverans', 'Utsugning', 'Snickerier', 'Övrigt'];

export default function AdminJobTypes() {
  const supabase = createClientComponentClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newColor, setNewColor] = useState('#475569');

  useEffect(() => {
    let isCancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data, error } = await supabase
          .from('planning_job_type_colors')
          .select('job_type,color_hex')
          .order('job_type');
        if (error) throw error;
        if (!isCancelled) setRows((data || []) as any);
      } catch (e: any) {
        if (!isCancelled) setError(e?.message || String(e));
      } finally {
        if (!isCancelled) setLoading(false);
      }
    })();
    const sub = supabase
      .channel('jobtype-colors')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planning_job_type_colors' }, (payload) => {
        setRows(prev => {
          const rec = (payload.new as any) || (payload.old as any);
          const jt = rec?.job_type as string;
          if (!jt) return prev;
          if (payload.eventType === 'DELETE') return prev.filter(r => r.job_type !== jt);
          const color_hex = (payload.new as any)?.color_hex as string;
          const existing = prev.find(r => r.job_type === jt);
          if (existing) return prev.map(r => r.job_type === jt ? { job_type: jt, color_hex } : r);
          return [...prev, { job_type: jt, color_hex }];
        });
      })
      .subscribe();
    return () => { sub.unsubscribe(); isCancelled = true; };
  }, [supabase]);

  const byType = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.job_type, r.color_hex);
    return m;
  }, [rows]);

  const allTypes = useMemo(() => {
    const set = new Set<string>(DEFAULT_JOB_TYPES);
    for (const r of rows) set.add(r.job_type);
    return Array.from(set).sort((a,b)=>a.localeCompare(b,'sv'));
  }, [rows]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const items = allTypes.map(j => ({ job_type: j, color_hex: byType.get(j) || '' }));
    if (!q) return items;
    return items.filter(it => it.job_type.toLowerCase().includes(q));
  }, [allTypes, byType, filter]);

  async function save(job_type: string, color_hex: string) {
    setError(null);
    try {
      if (!/^#?[0-9a-fA-F]{6}$/.test(color_hex)) throw new Error('Ogiltig färg. Använd hex, t.ex. #1d4ed8');
      const hex = color_hex.startsWith('#') ? color_hex : '#' + color_hex;
      const { error } = await supabase
        .from('planning_job_type_colors')
        .upsert({ job_type, color_hex: hex })
        .select()
        .single();
      if (error) throw error;
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function remove(job_type: string) {
    setError(null);
    try {
      const { error } = await supabase
        .from('planning_job_type_colors')
        .delete()
        .eq('job_type', job_type);
      if (error) throw error;
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }

  async function addCustom() {
    const key = newKey.trim();
    if (!key) return;
    await save(key, newColor);
    setNewKey('');
  }

  const customCount = rows.length;

  return (
    <div className="grid gap-3 p-4">
      <SectionCard className="grid gap-4 p-5">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-2">
            <Badge variant="accent" className="px-2.5 py-1 text-[11px] uppercase tracking-[0.35px]">Jobbtyper</Badge>
            <Badge>{visible.length} visade</Badge>
            <Badge>{customCount} egna färger</Badge>
          </div>
          <h2 className="m-0 text-xl text-slate-900">Färger för Jobbtyp/Material</h2>
          <p className="m-0 text-sm text-slate-500">Välj färg som visas på planeringskortens jobbtyp eller material. Lämna tom för standard.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filtrera..." className="min-h-9 max-w-[240px] px-2.5 py-2 text-[13px]" />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input value={newKey} onChange={e=>setNewKey(e.target.value)} placeholder="Ny jobbtyp…" className="min-h-9 w-[180px] px-2.5 py-2 text-[13px]" />
            <input type="color" value={newColor} onChange={e=>setNewColor(e.target.value)} className="h-9 w-9 rounded-lg border border-slate-300 bg-white p-1" />
            <Button onClick={addCustom} variant="secondary" size="sm">Lägg till</Button>
          </div>
        </div>

        {error && <ErrorState title="Kunde inte uppdatera job types" message={error} />}
      </SectionCard>

      <SectionCard className="p-4">
        {loading ? (
          <LoadingState label="Laddar job types" description="Hämtar nuvarande färgkopplingar och standardvärden." />
        ) : (
          <div className="grid gap-2">
            {visible.map(r => (
              <div key={r.job_type} className="grid gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-2.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <span className="font-semibold text-slate-900">{r.job_type}</span>
                  {r.color_hex ? (
                    <span className="text-xs font-medium" style={{ color: r.color_hex }}>Exempel</span>
                  ) : (
                    <span className="text-xs text-slate-500">Standardfärg</span>
                  )}
                </div>
                <input type="color" value={r.color_hex || '#475569'} onChange={e => save(r.job_type, e.target.value)} className="h-9 w-9 rounded-lg border border-slate-300 bg-white p-1" />
                <Button onClick={() => save(r.job_type, r.color_hex || '#475569')} variant="primary" size="sm">Spara</Button>
                <Button onClick={() => remove(r.job_type)} variant="secondary" size="sm">Rensa</Button>
              </div>
            ))}
            {visible.length === 0 && <EmptyState title="Inget att visa" description="Justera filtret eller lägg till en ny job type." />}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
