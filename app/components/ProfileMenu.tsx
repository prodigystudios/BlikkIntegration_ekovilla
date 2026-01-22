"use client";
import { useState, useRef, useEffect } from 'react';
import { useToast } from '@/lib/Toast';
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

export default function ProfileMenu({ fullName, role }: { fullName: string | null, role: 'member' | 'sales' | 'admin' | 'konsult' | null }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false); // flip to right edge if near viewport edge
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const supabase = createClientComponentClient();
  const toast = useToast();
  const [email, setEmail] = useState<string | null>(null);

  // Change password modal state
  const [pwdOpen, setPwdOpen] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (data.user?.email) setEmail(data.user.email);
      } catch {/* ignore */}
    })();
  }, [supabase]);

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

  function closePwd() {
    setPwdOpen(false);
    setCurrentPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setPwdError(null);
    setPwdLoading(false);
    setPwdSuccess(false);
  }

  async function submitPasswordChange() {
    if (!email) { setPwdError('Ingen e‑post kopplad till sessionen.'); return; }
    if (newPwd !== confirmPwd) { setPwdError('Lösenorden matchar inte.'); return; }
    const vErr = validatePassword(newPwd);
    if (vErr) { setPwdError(vErr); return; }
    setPwdError(null);
    setPwdLoading(true);
    try {
      // Re-authenticate with current password (defensive; Supabase does not strictly require but good UX / security)
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password: currentPwd });
      if (signErr) { setPwdError('Nuvarande lösenord fel.'); setPwdLoading(false); return; }
      const { error: updErr } = await supabase.auth.updateUser({ password: newPwd });
      if (updErr) { setPwdError(updErr.message); setPwdLoading(false); return; }
      // Sync cookie for SSR
      try { await fetch('/api/auth/callback', { method: 'POST', cache: 'no-store' }); } catch {}
      setPwdSuccess(true);
      toast?.success('Lösenord uppdaterat.');
      setTimeout(() => { closePwd(); }, 1600);
    } catch (e: any) {
      setPwdError(e?.message || 'Okänt fel vid uppdatering.');
    } finally {
      setPwdLoading(false);
    }
  }

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
          <button
            role="menuitem"
            onClick={() => { setPwdOpen(true); setOpen(false); }}
            className="btn--plain"
            style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8 }}
          >
            Byt lösenord
          </button>
        </div>
      )}
      {pwdOpen && (
        <div style={modalBackdrop}>
          <div style={modalCard} role="dialog" aria-modal="true" aria-labelledby="pwd-title">
            <h2 id="pwd-title" style={modalTitle}>Byt lösenord</h2>
            <form onSubmit={e => { e.preventDefault(); submitPasswordChange(); }} style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <label style={labelStyle}>Nuvarande lösenord
                <input type="password" value={currentPwd} onChange={e=>setCurrentPwd(e.target.value)} required autoComplete="current-password" style={inputStyle} disabled={pwdLoading||pwdSuccess} />
              </label>
              <label style={labelStyle}>Nytt lösenord
                <input type="password" value={newPwd} onChange={e=>setNewPwd(e.target.value)} required minLength={6} autoComplete="new-password" style={inputStyle} disabled={pwdLoading||pwdSuccess} />
              </label>
              <label style={labelStyle}>Bekräfta nytt lösenord
                <input type="password" value={confirmPwd} onChange={e=>setConfirmPwd(e.target.value)} required minLength={6} autoComplete="new-password" style={inputStyle} disabled={pwdLoading||pwdSuccess} />
              </label>
              {pwdError && <div style={errorBox}>{pwdError}</div>}
              {pwdSuccess && <div style={successBox}>Lösenord uppdaterat!</div>}
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:4 }}>
                <button type="button" onClick={() => closePwd()} style={ghostBtn} disabled={pwdLoading}>Avbryt</button>
                <button type="submit" style={primaryBtnSmall} disabled={pwdLoading||pwdSuccess}>{pwdLoading ? 'Sparar…' : pwdSuccess ? 'Klart' : 'Uppdatera'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function validatePassword(p: string) {
  if (p.length < 6) return 'Minst 6 tecken.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Minst en bokstav och en siffra rekommenderas.'; // soft guidance
  return null;
}

// Inline styles reused (borrowing palette from auth pages)
const modalBackdrop: React.CSSProperties = { position:'fixed', inset:0, background:'rgba(0,0,0,0.38)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 };
const modalCard: React.CSSProperties = { width:'100%', maxWidth:440, background:'#ffffff', border:'1px solid #e2e8f0', borderRadius:20, padding:'30px 30px 28px', boxShadow:'0 10px 34px -6px rgba(0,0,0,0.25)', display:'flex', flexDirection:'column', gap:18 };
const modalTitle: React.CSSProperties = { margin:0, fontSize:22, fontWeight:600, letterSpacing:-0.3, color:'#064e3b' };
const labelStyle: React.CSSProperties = { display:'flex', flexDirection:'column', gap:6, fontSize:13, fontWeight:500, color:'#0f3d2e' };
const inputStyle: React.CSSProperties = { padding:'10px 12px', border:'1px solid #94d5bb', borderRadius:10, fontSize:14, background:'#fff', color:'#064e3b' };
const primaryBtnSmall: React.CSSProperties = { padding:'10px 16px', borderRadius:10, background:'linear-gradient(135deg,#047857,#059669)', color:'#fff', fontSize:14, fontWeight:600, border:'1px solid #047857', cursor:'pointer', boxShadow:'0 3px 8px -2px rgba(4,120,87,0.45)' };
const ghostBtn: React.CSSProperties = { padding:'10px 16px', borderRadius:10, background:'#fff', color:'#047857', fontSize:14, fontWeight:600, border:'1px solid #94d5bb', cursor:'pointer' };
const errorBox: React.CSSProperties = { background:'#fef2f2', border:'1px solid #fecaca', color:'#b91c1c', padding:'8px 10px', fontSize:12.5, borderRadius:8, fontWeight:500 };
const successBox: React.CSSProperties = { background:'#ecfdf5', border:'1px solid #bbf7d0', color:'#065f46', padding:'8px 10px', fontSize:12.5, borderRadius:8, fontWeight:500 };

// Extend component with password logic below original export
// (legacy helper removed – inline closePwd used instead)

