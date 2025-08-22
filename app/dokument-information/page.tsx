export const dynamic = 'force-dynamic';

const documents = [
  {
    name: 'Mall: Densitet och Ytvikt',
    file: '/documents/mall-densitet-och-ytvikt.64f6f9f9d1fb36.45820158.png',
  },
  {
    name: 'Lathund Isolering',
    file: '/documents/LATHUND ISOLERINGsdsdas-1.64dc66a5b38ea2.85087943.png',
  },
];

export default function DokumentInformationPage() {
  return (
    <main style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1>Dokument & Information</h1>
      <p style={{ color: '#6b7280', marginTop: -6, marginBottom: 16 }}>Viktiga dokument och instruktioner för personalen.</p>
      <div style={{ display: 'grid', gap: 32 }}>
        {documents.map((doc, i) => (
          <div key={doc.file} style={{ border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 18 }}>
            <h2 style={{ fontSize: 18, margin: '0 0 12px 0' }}>{doc.name}</h2>
            <img src={doc.file} alt={doc.name} style={{ maxWidth: '100%', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }} />
            <div style={{ marginTop: 10 }}>
              <a href={doc.file} download style={{ color: '#2563eb', textDecoration: 'underline', fontSize: 15 }}>Ladda ner</a>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
