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
    router.replace("/korjournal");
  };

  return (
    <div style={{ padding: 24, maxWidth: 440 }}>
      <h1>Logga in</h1>
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>E-post</span>
          <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="din@epost.se"/>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Lösenord</span>
          <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="••••••••"/>
        </label>
        {error && <div style={{ color: '#b91c1c' }}>{error}</div>}
        <div>
          <button className="btn--primary" onClick={signIn} disabled={loading}>
            {loading ? 'Loggar in…' : 'Logga in'}
          </button>
        </div>
      </div>
    </div>
  );
}
