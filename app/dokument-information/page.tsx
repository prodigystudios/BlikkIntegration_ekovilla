export const dynamic = "force-dynamic";

const imageDocuments = [
  {
    name: "Mall: Densitet och Ytvikt",
    file: "/documents/mall-densitet-och-ytvikt.64f6f9f9d1fb36.45820158.png",
  },
  {
    name: "Lathund Isolering",
    file: "/documents/LATHUND ISOLERINGsdsdas-1.64dc66a5b38ea2.85087943.png",
  },
  // Blikk Rapport Tid Lathund 1-5
  {
    name: "Blikk Rapport Tid Lathund 1",
    file: "/documents/BLIKK rapportera tid LATHUND-1.png",
  },
  {
    name: "Blikk Rapport Tid Lathund 2",
    file: "/documents/BLIKK rapportera tid LATHUND-2.png",
  },
  {
    name: "Blikk Rapport Tid Lathund 3",
    file: "/documents/BLIKK rapportera tid LATHUND-3.png",
  },
  {
    name: "Blikk Rapport Tid Lathund 4",
    file: "/documents/BLIKK rapportera tid LATHUND-4.png",
  },
  {
    name: "Blikk Rapport Tid Lathund 5",
    file: "/documents/BLIKK rapportera tid LATHUND-5.png",
  },
];

const infoSections = [
  {
    name: "Försäkring Lastbil",
    content: (
      <span>
        Vid olycka med lastbil under Entreprenad så har vi försäkring på alla
        lastbilar som heter Protector försäkring och dom använder sig av
        Assistancekåren
        <br />
        Protector försäkring:{" "}
        <a
          href="tel:0841063700"
          style={{ color: "#2563eb", textDecoration: "underline" }}
        >
          08-410 637 00
        </a>
      </span>
    ),
  },
  {
    name: "Fallskydd ",
    content: (
      <span>
        Vi innehar taksäkerhetsselar för våra anställdas säkerhet.<br /> Det skall
        finnas ett sele-kit per bil. Dessa kit skall besiktigas en gång per år, <br />
        Patrik har koll på när. Dock ansvarar varje team att se till att det
        kommer in till wurth som besiktigar våra selar <br /> och återhämtar dom när
        det är dax. <br /> När detta är gjort så är det <strong>extremt viktigt</strong> att ni meddelar
        Patrik när ni har hämtat selen åter.
      </span>
    ),
  },
  // Lägg till fler informationsblock här
];

export default function DokumentInformationPage() {
  const densitetDoc = imageDocuments.find((d) => d.name.toLowerCase().includes("densitet"));
  const lathundDoc = imageDocuments.find((d) => d.name.toLowerCase().includes("lathund"));
  return (
    <main style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h1>Dokument & Information</h1>
      <p style={{ color: "#6b7280", marginTop: -6, marginBottom: 6 }}>
        Viktiga dokument och instruktioner för personalen.
      </p>
      {/* Per-section hint moved to the right of each H2 below */}
  {/* Section: Bilder */}
  <h2 style={{ fontSize: 20, margin: '32px 0 10px 0' }}>Bilder</h2>
      {/* First dropdown: Mall Densitet */}
      {densitetDoc && (
        <details className="accordion-panel">
          <summary className="accordion-summary">Mall Densitet</summary>
          <div className="accordion-content">
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 16, margin: "10px 0 8px 0" }}>{densitetDoc.name}</div>
              <img
                src={densitetDoc.file}
                alt={densitetDoc.name}
                style={{ maxWidth: "100%", borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
              />
              <div style={{ marginTop: 8 }}>
                <a href={densitetDoc.file} download style={{ color: "#2563eb", textDecoration: "underline", fontSize: 15 }}>
                  Ladda ner
                </a>
              </div>
            </div>
          </div>
        </details>
      )}

      {/* Second dropdown: Lathund Isolering */}
      {lathundDoc && (
        <details className="accordion-panel">
          <summary className="accordion-summary">Lathund Isolering</summary>
          <div className="accordion-content">
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 16, margin: "10px 0 8px 0" }}>{lathundDoc.name}</div>
              <img
                src={lathundDoc.file}
                alt={lathundDoc.name}
                style={{ maxWidth: "100%", borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}
              />
              <div style={{ marginTop: 8 }}>
                <a href={lathundDoc.file} download style={{ color: "#2563eb", textDecoration: "underline", fontSize: 15 }}>
                  Ladda ner
                </a>
              </div>
            </div>
          </div>
        </details>
      )}

      {/* Third dropdown: Rapportera tid i Blikk (5 bilder) */}
      {(() => {
        const blikkTimeDocs = imageDocuments.filter((doc) => {
          const n = doc.name.toLowerCase();
          return n.includes('blikk rapport tid lathund') || n.includes('rapportera tid i blikk');
        });
        if (blikkTimeDocs.length === 0) return null;
        return (
          <details className="accordion-panel">
            <summary className="accordion-summary">Rapportera tid i Blikk</summary>
            <div className="accordion-content">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {blikkTimeDocs.map((doc) => (
                  <div key={doc.file} style={{ maxWidth: '100%' }}>
                    <div style={{ fontWeight: 600, fontSize: 15, margin: '10px 0 8px 0' }}>{doc.name}</div>
                    <img
                      src={doc.file}
                      alt={doc.name}
                      style={{ maxWidth: '100%', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
                    />
                    <div style={{ marginTop: 8 }}>
                      <a href={doc.file} download style={{ color: '#2563eb', textDecoration: 'underline', fontSize: 15 }}>
                        Ladda ner
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </details>
        );
      })()}

  {/* Section: Information */}
  <h2 style={{ fontSize: 20, margin: '32px 0 10px 0' }}>Information</h2>
      <div style={{ display: "grid"}}>
        {infoSections.map((info) => (
          <details key={info.name} className="accordion-panel">
            <summary className="accordion-summary">{info.name}</summary>
            <div className="accordion-content" style={{ fontSize: 15 ,padding: '0 22px 18px 22px' ,paddingTop:10}}>{info.content}</div>
          </details>
        ))}
      </div>
    </main>
  );
}
