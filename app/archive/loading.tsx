export default function Loading() {
  return (
    <main className="archive">
      <h1>Egenkontroller</h1>
      <p aria-live="polite" style={{ color: '#6b7280', marginTop: 4 }}>Laddar arkiv…</p>
      <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: '1fr 120px 120px',
            gap: 8,
            alignItems: 'center',
            padding: '12px 12px',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: '#fafafa'
          }}>
            <div style={{ height: 14, background: '#e5e7eb', borderRadius: 4, width: '70%' }} />
            <div style={{ height: 12, background: '#e5e7eb', borderRadius: 4, width: '80%' }} />
            <div style={{ height: 32, background: '#e5e7eb', borderRadius: 6 }} />
          </div>
        ))}
      </div>
    </main>
  );
}
