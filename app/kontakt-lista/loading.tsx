export default function Loading() {
  return (
    <main style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1>Kontaktlista</h1>
      <p style={{ color: '#6b7280' }}>Laddar kontakter…</p>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginTop: 12 }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', borderTop: i ? '1px solid #e5e7eb' : undefined }}>
            <div style={{ padding: '12px', background: i % 2 ? '#f9fafb' : '#fff' }}>&nbsp;</div>
            <div style={{ padding: '12px', background: i % 2 ? '#f9fafb' : '#fff' }}>&nbsp;</div>
            <div style={{ padding: '12px', background: i % 2 ? '#f9fafb' : '#fff' }}>&nbsp;</div>
          </div>
        ))}
      </div>
    </main>
  );
}
