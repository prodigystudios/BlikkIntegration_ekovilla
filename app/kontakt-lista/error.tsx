"use client";
export default function Error({ error }: { error: Error & { digest?: string } }) {
  return (
    <main style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1>Kontaktlista</h1>
      <p style={{ color: '#ef4444' }}>Kunde inte ladda kontaktlistan.</p>
      <pre style={{ whiteSpace: 'pre-wrap', background: '#fff7ed', padding: 12, borderRadius: 6, border: '1px solid #fed7aa' }}>{error.message}</pre>
    </main>
  );
}
