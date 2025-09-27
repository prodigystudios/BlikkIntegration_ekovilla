"use client";
import { useState, useRef, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';

function IconUser(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

export default function ProfileMenu({ fullName, role }: { fullName: string | null, role: 'member' | 'sales' | 'admin' | null }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false); // flip to right edge if near viewport edge
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const supabase = createClientComponentClient();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!open) return;
      const t = e.target as Node;
      if (popRef.current && !popRef.current.contains(t) && btnRef.current && !btnRef.current.contains(t)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // If remaining space to right is less than popover width (220 incl padding) -> align right
      const remaining = window.innerWidth - rect.left;
      setAlignRight(remaining < 240);
    }
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Removed client-side fetch; fullName is passed from server layout.

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace('/auth/sign-in');
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Profil"
        onClick={() => setOpen(o => !o)}
        style={{ padding: 8, borderRadius: 50, border: '1px solid #e5e7eb', background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <IconUser />
      </button>
      {open && (
        <div
          ref={popRef}
          role="menu"
          aria-label="Profilmeny"
          style={{ position: 'absolute', top: 'calc(100% + 6px)', [alignRight ? 'right' : 'left']: 0, minWidth: 200, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,0.08)', padding: 8, zIndex: 40 }}
        >
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280', padding: '4px 8px 6px' }}>Konto</div>
          <div style={{ padding: '0 8px 2px', fontSize: 14, fontWeight: 500, color: '#111827', lineHeight: 1.2 }}>
            {fullName || 'Inget namn'}
          </div>
          <div style={{ padding: '0 8px 8px', fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {role || 'ingen roll'}
          </div>
          {!fullName && <div style={{ padding: '0 8px 8px', fontSize: 11, color: '#6b7280' }}>Namn saknas.</div>}
          <button
            role="menuitem"
            onClick={logout}
            className="btn--plain"
            style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8 }}
          >
            Logga ut
          </button>
        </div>
      )}
    </div>
  );
}
