"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

// Lightweight account creation page (not linked in main navigation)
// Used to self-provision new member accounts. New users default to role 'member'.
export default function CreateAccountPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) { setError('Ange fullständigt namn.'); return; }
    if (!email.trim()) { setError('Ange e-post.'); return; }
    if (password.length < 6) { setError('Lösenord måste vara minst 6 tecken.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      // Sign up with metadata so profile trigger (if any) can use it
      const { data, error: signError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim(), display_name: fullName.trim(), role: 'member' } }
      });
      if (signError) { setError(signError.message); setSubmitting(false); return; }

      // Some projects require email confirmation; detect session
      const needsConfirmation = !data.session;

      // If we DO have an active session (email confirm not required), patch profile row immediately (trigger already sets it anyway).
      if (data.user && data.session) {
        try {
          await supabase.from('profiles')
            .update({ full_name: fullName.trim(), role: 'member' })
            .eq('id', data.user.id);
        } catch {/* ignore */}
      }

      setSuccess(true);
      setSubmitting(false);
      // If immediate session present, sync cookie then redirect after short delay
      if (!needsConfirmation) {
        try { await fetch('/api/auth/callback', { method: 'POST', cache: 'no-store' }); } catch {}
        setTimeout(()=>{ router.replace('/'); }, 800);
      }
    } catch (e: any) {
      setError(e.message || 'Något gick fel.');
      setSubmitting(false);
    }
  };

  return (
    <div style={outerWrap} className="create-root">
      <div style={cardWrap} className="create-card">
        <h1 style={titleStyle}>Skapa konto</h1>
        <p style={subStyle}>Fyll i uppgifterna nedan för att skapa ett nytt internt konto.</p>
        <form onSubmit={handleSubmit} style={formStyle}>
          <label style={labelStyle}>
            <span style={labelTxt}>Fullständigt namn</span>
            <input style={inputStyle} value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="För- och efternamn" autoComplete="name" required />
          </label>
          <label style={labelStyle}>
            <span style={labelTxt}>E-post</span>
            <input style={inputStyle} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="din@epost.se" autoComplete="email" required />
          </label>
          <label style={labelStyle}>
            <span style={labelTxt}>Lösenord</span>
            <input style={inputStyle} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minst 6 tecken" autoComplete="new-password" required />
          </label>
          {error && <div style={errorBox}>{error}</div>}
          {success && (
            <div style={successBox}>
              Konto skapat! {` `}
              {!password ? null : ' '} 
              <strong>{email}</strong>{' '}<br />
              {` `} {`En bekräftelselänk kan ha skickats om verifiering krävs.`}
            </div>
          )}
          <button type="submit" style={primaryBtn} disabled={submitting || success}>
            {submitting ? 'Skapar…' : success ? 'Klart' : 'Skapa konto'}
          </button>
        </form>
        <div style={footNote}>Har du redan konto? <a href="/auth/sign-in" style={linkStyle}>Logga in</a></div>
      </div>
    <style>{`
        @media (max-width: 600px) {
          .create-card { padding:24px 22px 30px !important; gap:18px !important; }
          .create-card h1 { font-size:26px !important; }
          .create-card form { gap:14px !important; }
          .create-card input { padding:11px 12px !important; font-size:14px !important; }
          .create-card button { padding:13px 16px !important; font-size:14px !important; }
        }
        @media (prefers-color-scheme: dark) {
      .create-root { background:#0f2a21 !important; }
          .create-card { background:#0f3d2e !important; border-color:#115e46 !important; }
          .create-card h1 { color:#d1fae5 !important; }
          .create-card p { color:#a7f3d0 !important; }
          .create-card input { background:#0f2a21 !important; border-color:#1d6f55 !important; color:#ecfdf5 !important; }
          .create-card input:focus { outline:1px solid #10b981; }
          .create-card button { background:linear-gradient(135deg,#059669,#10b981) !important; border-color:#059669 !important; }
          .create-card a { color:#34d399 !important; }
        }
      `}</style>
    </div>
  );
}

// Styles (reusing palette from sign-in)
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
