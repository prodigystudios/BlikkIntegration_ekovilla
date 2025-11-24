"use client";
import { useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useToast } from "@/lib/Toast";

export default function ResetPasswordPage() {
  const supabase = createClientComponentClient();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return setError('Ange e‑post.');
    setLoading(true);
    try {
      const { error: supaErr } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/reset-password-confirm`
      });
      if (supaErr) throw supaErr;
      setSuccess(true);
      toast?.success('Återställningslänk skickad till din e‑post.');
    } catch (e: any) {
      setError(e?.message || 'Något gick fel vid återställning av lösenord.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={outerWrap} className="reset-root">
      <div style={cardWrap} className="reset-card">
        <h1 style={titleStyle}>Återställ lösenord</h1>
        <p style={subStyle}>Ange din e‑postadress så skickar vi en länk för att återställa ditt lösenord.</p>
        {success ? (
          <div style={successBox}>
            Om e‑postadressen finns i systemet har vi skickat en återställningslänk. Följ instruktionerna i mailet.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={formStyle}>
            <label style={labelStyle}>
              <span style={labelTxt}>E‑post</span>
              <input style={inputStyle} type="email" value={email} onChange={e=>setEmail(e.target.value.toLowerCase())} placeholder="din@epost.se" autoComplete="email" required disabled={loading} />
            </label>
            {error && <div style={errorBox}>{error}</div>}
            <button type="submit" style={primaryBtn} disabled={loading}>{loading ? 'Skickar…' : 'Skicka återställningslänk'}</button>
          </form>
        )}
        <div style={footNote}>Tillbaka till <a href="/auth/sign-in" style={linkStyle}>Logga in</a></div>
      </div>
      <style>{`
        @media (max-width: 600px) {
          .reset-card { padding:24px 22px 30px !important; gap:18px !important; }
          .reset-card h1 { font-size:26px !important; }
          .reset-card form { gap:14px !important; }
          .reset-card input { padding:11px 12px !important; font-size:14px !important; }
          .reset-card button { padding:13px 16px !important; font-size:14px !important; }
        }
        @media (prefers-color-scheme: dark) {
          .reset-root { background:#0f2a21 !important; }
          .reset-card { background:#0f3d2e !important; border-color:#115e46 !important; }
          .reset-card h1 { color:#d1fae5 !important; }
          .reset-card p { color:#a7f3d0 !important; }
          .reset-card input { background:#0f2a21 !important; border-color:#1d6f55 !important; color:#ecfdf5 !important; }
          .reset-card input:focus { outline:1px solid #10b981; }
          .reset-card button { background:linear-gradient(135deg,#059669,#10b981) !important; border-color:#059669 !important; }
          .reset-card a { color:#34d399 !important; }
        }
      `}</style>
    </div>
  );
}

// Styles (reusing palette from sign-in/create-account)
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
