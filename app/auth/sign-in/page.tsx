"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export default function SignInPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    if (!email || !password) {
      setError("Ange e-post och lösenord.");
      return;
    }
    setLoading(true);
    setError(null);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
  // Ensure server session cookie is synced before navigating (important for PWA)
  try { await fetch('/api/auth/callback', { method: 'POST', cache: 'no-store' }); } catch {}
  router.replace("/");
    // In case the app shell cached page doesn’t pick up the session instantly, do a delayed refresh once.
    setTimeout(() => {
      try {
        // Only attempt if still on sign-in route
        if (window.location.pathname.startsWith('/auth')) {
          window.location.href = '/';
        }
      } catch {}
    }, 250);
  };

  return (
    <div style={outerWrap} className="auth-outer">
      <div style={panelWrap} className="auth-panel">
        <div style={brandCol} className="auth-brand">
          <div style={brandInner} className="brand-inner">
            <div style={logoCircle} className="brand-logo">
              <img
                src="/brand/Ekovilla_logo_Header.png"
                alt="Ekovilla"
                style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', filter:'drop-shadow(0 2px 4px rgba(0,0,0,0.25))' }}
                draggable={false}
              />
            </div>
            <h1 style={heroTitle}>Välkommen tillbaka</h1>
            <p style={heroSub} className="hero-sub">Logga in för att fortsätta ditt arbete.</p>
            <ul style={bulletList} className="feature-bullets">
              <li>Snabb åtkomst till egenkontroller</li>
              <li>Hantera kontakter och adresser</li>
              <li>Kommande planering & dashboards</li>
            </ul>
            <p style={footNote}>Behöver du ett konto? Kontakta administratör.</p>
          </div>
        </div>
        <div style={formCol} className="auth-form-col">
          <div style={card} className="auth-card">
            <h2 style={cardTitle}>Logga in</h2>
            <form onSubmit={e=>{e.preventDefault(); signIn();}} style={formGrid}>
              <label style={fieldLabel}>
                <span style={labelText}>E-post</span>
                <input
                  type="email"
                  value={email}
                  onChange={e=>setEmail(e.target.value)}
                  placeholder="din@epost.se"
                  style={inputStyle}
                  autoComplete="email"
                  required
                />
              </label>
              <label style={fieldLabel}>
                <span style={labelText}>Lösenord</span>
                <input
                  type="password"
                  value={password}
                  onChange={e=>setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={inputStyle}
                  autoComplete="current-password"
                  required
                />
              </label>
              {error && <div style={errorBox}>{error}</div>}
              <button type="submit" style={primaryBtn} disabled={loading}>
                {loading ? 'Loggar in…' : 'Logga in'}
              </button>
            </form>
            <div style={auxLinks}>© {new Date().getFullYear()} Ekovilla Intern</div>
          </div>
        </div>
      </div>
      <style>{`
        /* Base (move critical responsive targets out of inline to allow overrides) */
        .auth-panel { display:grid; grid-template-columns: minmax(0,520px) minmax(0,440px); }
        .auth-brand { transition: padding .25s, background .3s; }
        .auth-form-col { transition: padding .25s; }

        /* Responsive layout adjustments */
        @media (max-width: 980px) {
          .auth-panel { grid-template-columns: 1fr !important; border-radius: 28px !important; }
          .auth-brand { padding: 40px 44px 36px !important; }
          .auth-form-col { padding: 40px 44px 48px !important; }
        }
        @media (max-width: 720px) {
          .auth-brand { padding: 32px 32px 28px !important; }
          .brand-logo { width:150px !important; height:64px !important; }
          .auth-form-col { padding: 32px 32px 40px !important; }
          .auth-card h2 { font-size: 24px !important; }
        }
        @media (max-width: 600px) {
          .auth-panel { background: #ffffffee !important; backdrop-filter: blur(4px) !important; -webkit-backdrop-filter: blur(4px) !important; box-shadow: 0 6px 24px -6px rgba(6,78,59,0.25) !important; }
          .auth-brand { background: linear-gradient(150deg,#047857 0%,#059669 90%) !important; border-bottom: 1px solid #10b98155 !important; }
          .feature-bullets { display: none !important; }
          .hero-sub { font-size: 14px !important; }
        }
        @media (max-width: 460px) {
          .auth-brand { padding: 26px 22px 22px !important; }
          .auth-form-col { padding: 28px 22px 36px !important; }
          .auth-card form { gap: 14px !important; }
          .auth-card button { padding: 12px 16px !important; font-size: 14px !important; }
          .auth-card input { padding: 11px 13px !important; font-size: 14px !important; }
          .brand-logo { width:150px !important; height:56px !important; border-radius:16px !important; }
          .auth-card h2 { font-size: 22px !important; }
        }
        @media (prefers-color-scheme: dark) {
          .auth-panel { background: #0d1f1aee !important; border-color:#115e46 !important; }
          .auth-card h2 { color:#d1fae5 !important; }
          .auth-card input { background:#0f2a21 !important; border-color:#1d6f55 !important; color:#d1fae5 !important; }
          .auth-card input:focus { outline:1px solid #10b981 !important; }
          .auth-card button { background:linear-gradient(135deg,#059669,#10b981) !important; border-color:#059669 !important; }
          .auth-brand { background:linear-gradient(140deg,#022c22 0%,#064e3b 100%) !important; }
        }
      `}</style>
    </div>
  );
}

// Layout styles (green palette)
// Palette reference:
//   Dark base: #0f3d2e
//   Deep: #064e3b
//   Primary mid: #047857
//   Accent: #10b981
//   Light bg: #f0fdf4
const outerWrap: React.CSSProperties = { minHeight:'100dvh', background:'radial-gradient(circle at 35% 25%, #f0fdf4 0%, #ecfdf5 30%, #f6fef9 60%)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 };
const panelWrap: React.CSSProperties = { width:'100%', maxWidth:1180, display:'grid', gridTemplateColumns:'minmax(0,520px) minmax(0,440px)', background:'#ffffffcc', backdropFilter:'blur(7px)', border:'1px solid #d1fae5', borderRadius:32, overflow:'hidden', boxShadow:'0 8px 30px -8px rgba(6,78,59,0.25)' };
const brandCol: React.CSSProperties = { position:'relative', padding:'56px 56px 48px', background:'linear-gradient(140deg,#064e3b 0%, #036449 55%, #047857 100%)', color:'#ecfdf5', display:'flex' };
const brandInner: React.CSSProperties = { maxWidth:420, display:'flex', flexDirection:'column', gap:24 };
const logoCircle: React.CSSProperties = { width:180, height:72, borderRadius:20, background:'linear-gradient(135deg,#d1fae5,#a7f3d0)', display:'flex', alignItems:'center', justifyContent:'center', padding:10, boxShadow:'0 4px 10px -2px rgba(6,78,59,0.35)' };
const heroTitle: React.CSSProperties = { margin:'8px 0 0', fontSize:38, lineHeight:1.05, letterSpacing:-0.5, fontWeight:700, color:'#ecfdf5' };
const heroSub: React.CSSProperties = { margin:0, fontSize:16, lineHeight:1.5, color:'#bbf7d0', fontWeight:400 };
const bulletList: React.CSSProperties = { margin:0, padding:'4px 0 0 18px', display:'flex', flexDirection:'column', gap:6, fontSize:14, lineHeight:1.4, color:'#d1fae5' };
const footNote: React.CSSProperties = { margin:'4px 0 0', fontSize:12, color:'#a7f3d0' };

// Form column
const formCol: React.CSSProperties = { display:'flex', alignItems:'center', justifyContent:'center', padding:'48px 48px' };
const card: React.CSSProperties = { width:'100%', display:'flex', flexDirection:'column', gap:28 };
const cardTitle: React.CSSProperties = { margin:0, fontSize:28, letterSpacing:-0.5, fontWeight:600, color:'#064e3b' };
const formGrid: React.CSSProperties = { display:'flex', flexDirection:'column', gap:18 };
const fieldLabel: React.CSSProperties = { display:'flex', flexDirection:'column', gap:8 };
const labelText: React.CSSProperties = { fontSize:13, fontWeight:600, letterSpacing:0.4, textTransform:'uppercase', color:'#ffffffff' };
const inputStyle: React.CSSProperties = { padding:'12px 14px', border:'1px solid #94d5bb', borderRadius:12, fontSize:15, outline:'none', background:'#ffffff', fontWeight:500, color:'#064e3b', boxShadow:'0 1px 2px rgba(6,78,59,0.08)', transition:'border-color .15s, box-shadow .15s' };
const primaryBtn: React.CSSProperties = { padding:'14px 18px', borderRadius:14, background:'linear-gradient(135deg,#047857,#059669)', color:'#ffffff', fontSize:15, fontWeight:600, border:'1px solid #047857', cursor:'pointer', letterSpacing:0.3, boxShadow:'0 3px 8px -2px rgba(4,120,87,0.45)' };
const errorBox: React.CSSProperties = { background:'#fef2f2', border:'1px solid #fecaca', color:'#b91c1c', padding:'10px 12px', fontSize:13, borderRadius:10, fontWeight:500 };
const auxLinks: React.CSSProperties = { fontSize:12, color:'#065f46', textAlign:'center', marginTop:-12, opacity:.85 };

