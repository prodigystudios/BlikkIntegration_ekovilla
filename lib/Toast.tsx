"use client";
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: string; kind: ToastKind; message: string; createdAt: number; ttl: number };

type ToastContextValue = {
  push: (kind: ToastKind, message: string, opts?: { ttl?: number }) => void;
  success: (message: string, opts?: { ttl?: number }) => void;
  error: (message: string, opts?: { ttl?: number }) => void;
  info: (message: string, opts?: { ttl?: number }) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setItems(list => list.filter(t => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string, opts?: { ttl?: number }) => {
    const ttl = Math.max(1500, Math.min(10_000, opts?.ttl ?? (kind === 'error' ? 5000 : 2500)));
    const id = Math.random().toString(36).slice(2);
    const t: ToastItem = { id, kind, message, createdAt: Date.now(), ttl };
    setItems(list => [...list, t]);
    // auto-dismiss
    setTimeout(() => remove(id), ttl);
  }, [remove]);

  const value = useMemo<ToastContextValue>(() => ({
    push,
    success: (m, o) => push('success', m, o),
    error: (m, o) => push('error', m, o),
    info: (m, o) => push('info', m, o),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onClose={remove} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

function ToastViewport({ items, onClose }: { items: ToastItem[]; onClose: (id: string) => void }) {
  return (
    <div aria-live="polite" aria-atomic="true"
      style={{ position: 'fixed', zIndex: 2000, right: 12, top: 66, display: 'grid', gap: 8, width: 'min(92vw, 360px)' }}>
      {items.map(t => (
        <div key={t.id} role="status"
          style={{
            borderRadius: 10,
            border: '1px solid ' + (t.kind === 'error' ? '#fecaca' : t.kind === 'success' ? '#bbf7d0' : '#e5e7eb'),
            background: t.kind === 'error' ? '#fef2f2' : t.kind === 'success' ? '#f0fdf4' : '#ffffff',
            color: '#0f172a',
            padding: '10px 12px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 16 }}>
            {t.kind === 'error' ? '⛔' : t.kind === 'success' ? '✅' : 'ℹ️'}
          </span>
          <div style={{ flex: 1, fontSize: 14, lineHeight: 1.35 }}>{t.message}</div>
          <button onClick={() => onClose(t.id)} aria-label="Stäng notis" style={{
            border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer', padding: '2px 6px', fontSize: 12
          }}>Stäng</button>
        </div>
      ))}
    </div>
  );
}
