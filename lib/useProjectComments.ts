"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatRelativeTime } from '@/lib/shared/relativeTime';

export interface ProjectComment {
  id: string;
  text: string;
  createdAt: string | null;
  userName: string | null;
}

interface CacheEntry { fetchedAt: number; items: ProjectComment[]; }
const globalCache: Map<string, CacheEntry> = new Map();

export interface UseProjectCommentsOptions {
  ttlMs?: number; // default 120s
  auto?: boolean; // auto fetch on mount / projectId change
  limit?: number; // slice list
}


export function useProjectComments(projectId: string | null | undefined, opts?: UseProjectCommentsOptions) {
  const ttlMs = opts?.ttlMs ?? 120_000;
  const limit = opts?.limit;
  const auto = opts?.auto !== false; // default true
  const [items, setItems] = useState<ProjectComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPidRef = useRef<string | null>(null);

  const fetchComments = useCallback(async (force?: boolean) => {
    const pid = projectId ? String(projectId) : '';
    if (!pid) { setItems([]); return []; }
    const cached = globalCache.get(pid);
    const now = Date.now();
    if (!force && cached && (now - cached.fetchedAt) < ttlMs) {
      setItems(limit ? cached.items.slice(0, limit) : cached.items);
      return cached.items;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/blikk/project/comments?projectId=${encodeURIComponent(pid)}`);
      const j = await res.json().catch(()=>({ comments: [] }));
      if (!res.ok || j?.error) {
        setError(j?.error || 'Kunde inte hämta kommentarer');
        return [];
      }
      if (Array.isArray(j.comments)) {
        globalCache.set(pid, { fetchedAt: Date.now(), items: j.comments });
        setItems(limit ? j.comments.slice(0, limit) : j.comments);
        return j.comments;
      }
    } catch (e: any) {
      setError('Fel vid hämtning av kommentarer');
    } finally {
      setLoading(false);
    }
    return [];
  }, [projectId, ttlMs, limit]);

  useEffect(() => {
    if (!auto) return;
    if (projectId == null) { setItems([]); return; }
    if (lastPidRef.current !== projectId) {
      lastPidRef.current = projectId;
      // fire & forget
      fetchComments(false);
    }
  }, [projectId, auto, fetchComments]);

  return { comments: items, loading, error, refresh: (force?: boolean) => fetchComments(force), formatRelativeTime };
}

// Bor i lib/shared/relativeTime.ts sedan CRM-översikten behövde samma formatering. Re-exporten
// står kvar: mina-jobb, DashboardSchedule och den skyddade planeringsytan importerar den härifrån.
export { formatRelativeTime };
