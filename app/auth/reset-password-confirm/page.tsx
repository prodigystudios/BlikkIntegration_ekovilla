"use client";
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export default function ResetPasswordConfirmPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Verify recovery session exists (user is temporarily authenticated via the email link)
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        setHasSession(!!data.user);
      } catch {
        setHasSession(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password || password.length < 6) { setError('Lösenord måste vara minst 6 tecken.'); return; }
    if (password !== password2) { setError('Lösenorden matchar inte.'); return; }
    setSubmitting(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      setSuccess(true);
      // Sync cookie and redirect
      try { await fetch('/api/auth/callback', { method: 'POST', cache: 'no-store' }); } catch {}
      setTimeout(() => { router.replace('/'); }, 600);
    } catch (e: any) {
      setError(e?.message || 'Kunde inte uppdatera lösenord. Länken kan vara förbrukad.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={outerWrap} className="reset-confirm-root">
      <div style={cardWrap} className="reset-confirm-card">
        <h1 style={titleStyle}>Byt lösenord</h1>
        {loading ? (
          <p style={subStyle}>Kontrollerar länk…</p>
        ) : !hasSession ? (
          <div style={errorBox}>
            Länken är ogiltig eller har gått ut. Be om en ny återställningslänk på
            {' '}<a href="/auth/reset-password" style={linkStyle}>Återställ lösenord</a>.
          </div>
        ) : success ? (
          <div style={successBox}>Lösenord uppdaterat. Du skickas vidare…</div>
        ) : (
          <form onSubmit={onSubmit} style={formStyle}>
            <label style={labelStyle}>
              <span style={labelTxt}>Nytt lösenord</span>
              <input style={inputStyle} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minst 6 tecken" autoComplete="new-password" required />
            </label>
            <label style={labelStyle}>
              <span style={labelTxt}>Bekräfta lösenord</span>
              <input style={inputStyle} type="password" value={password2} onChange={e=>setPassword2(e.target.value)} placeholder="Skriv igen" autoComplete="new-password" required />
            </label>
            {error && <div style={errorBox}>{error}</div>}
            <button type="submit" style={primaryBtn} disabled={submitting}>{submitting ? 'Uppdaterar…' : 'Uppdatera lösenord'}</button>
          </form>
        )}
        <div style={footNote}>Behöver hjälp? <a href="/auth/sign-in" style={linkStyle}>Logga in</a></div>
      </div>
      <style>{`
        @media (max-width: 600px) {
          .reset-confirm-card { padding:24px 22px 30px !important; gap:18px !important; }
          .reset-confirm-card h1 { font-size:26px !important; }
          .reset-confirm-card form { gap:14px !important; }
          .reset-confirm-card input { padding:11px 12px !important; font-size:14px !important; }
          .reset-confirm-card button { padding:13px 16px !important; font-size:14px !important; }
        }
        @media (prefers-color-scheme: dark) {
          .reset-confirm-root { background:#0f2a21 !important; }
          .reset-confirm-card { background:#0f3d2e !important; border-color:#115e46 !important; }
          .reset-confirm-card h1 { color:#d1fae5 !important; }
          .reset-confirm-card p { color:#a7f3d0 !important; }
          .reset-confirm-card input { background:#0f2a21 !important; border-color:#1d6f55 !important; color:#ecfdf5 !important; }
          .reset-confirm-card input:focus { outline:1px solid #10b981; }
          .reset-confirm-card button { background:linear-gradient(135deg,#059669,#10b981) !important; border-color:#059669 !important; }
          .reset-confirm-card a { color:#34d399 !important; }
        }
      `}</style>
    </div>
  );
}

// Styles reused from auth palette
const outerWrap: React.CSSProperties = { minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', padding:24, background:'radial-gradient(circle at 35% 25%, #f0fdf4 0%, #ecfdf5 30%, #f6fef9 60%)' };
const cardWrap: React.CSSProperties = { width:'100%', maxWidth:520, background:'#ffffffcc', backdropFilter:'blur(6px)', border:'1px solid #d1fae5', borderRadius:28, padding:'40px 40px 48px', display:'flex', flexDirection:'column', gap:24, boxShadow:'0 8px 28px -8px rgba(6,78,59,0.28)', position:'relative' , overflow:'hidden', };
const titleStyle: React.CSSProperties = { margin:0, fontSize:32, fontWeight:650, letterSpacing:-0.5, color:'#064e3b' };
const subStyle: React.CSSProperties = { margin:'-4px 0 4px', fontSize:15, lineHeight:1.5, color:'#065f46' };
const formStyle: React.CSSProperties = { display:'flex', flexDirection:'column', gap:18 };
const labelStyle: React.CSSProperties = { display:'flex', flexDirection:'column', gap:6 };
const labelTxt: React.CSSProperties = { fontSize:12, fontWeight:600, letterSpacing:0.6, textTransform:'uppercase', color:'#ffffffff' };
const inputStyle: React.CSSProperties = { padding:'12px 14px', border:'1px solid #94d5bb', borderRadius:12, fontSize:15, outline:'none', background:'#ffffff', fontWeight:500, color:'#064e3b', boxShadow:'0 1px 2px rgba(6,78,59,0.05)' };
const primaryBtn: React.CSSProperties = { padding:'14px 18px', borderRadius:14, background:'linear-gradient(135deg,#047857,#059669)', color:'#ffffff', fontSize:15, fontWeight:600, border:'1px solid #047857', cursor:'pointer', letterSpacing:0.3, boxShadow:'0 3px 8px -2px rgba(4,120,87,0.45)' };
const errorBox: React.CSSProperties = { background:'#fef2f2', border:'1px solid #fecaca', color:'#b91c1c', padding:'10px 12px', fontSize:13, borderRadius:10, fontWeight:500 };
const successBox: React.CSSProperties = { background:'#ecfdf5', border:'1px solid #bbf7d0', color:'#065f46', padding:'10px 12px', fontSize:13, borderRadius:10, fontWeight:500 };
const footNote: React.CSSProperties = { marginTop:8, fontSize:12, color:'#ffffffff' };
const linkStyle: React.CSSProperties = { color:'#047857', fontWeight:600, textDecoration:'none' };
