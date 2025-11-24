"use client";
import { useCallback, useEffect, useRef, useState } from 'react';

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

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.slice(0,16).replace('T',' ');
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return 'nyss';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return 'nyss';
  const min = Math.floor(sec / 60);
  if (min < 2) return '1 min sedan';
  if (min < 60) return `${min} min sedan`;
  const hrs = Math.floor(min / 60);
  if (hrs < 2) return '1 h sedan';
  if (hrs < 24) return `${hrs} h sedan`;
  const days = Math.floor(hrs / 24);
  if (days < 2) return '1 dag sedan';
  if (days < 7) return `${days} dagar sedan`;
  const weeks = Math.floor(days / 7);
  if (weeks < 2) return '1 v sedan';
  if (weeks < 5) return `${weeks} v sedan`;
  const months = Math.floor(days / 30);
  if (months < 2) return '1 mån sedan';
  if (months < 12) return `${months} mån sedan`;
  const years = Math.floor(days / 365);
  if (years < 2) return '1 år sedan';
  return `${years} år sedan`;
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

export { formatRelativeTime };
