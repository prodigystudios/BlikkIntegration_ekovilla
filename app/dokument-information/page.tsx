export const dynamic = "force-dynamic";

import type { ReactNode } from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

const imageDocuments = [
  { name: "Mall: Densitet och Ytvikt", file: "/documents/mall-densitet-och-ytvikt.64f6f9f9d1fb36.45820158.png" },
  { name: "Lathund Isolering", file: "/documents/LATHUND ISOLERINGsdsdas-1.64dc66a5b38ea2.85087943.png" },
  { name: "Blikk Rapport Tid Lathund 1", file: "/documents/BLIKK rapportera tid LATHUND-1.png" },
  { name: "Blikk Rapport Tid Lathund 2", file: "/documents/BLIKK rapportera tid LATHUND-2.png" },
  { name: "Blikk Rapport Tid Lathund 3", file: "/documents/BLIKK rapportera tid LATHUND-3.png" },
  { name: "Blikk Rapport Tid Lathund 4", file: "/documents/BLIKK rapportera tid LATHUND-4.png" },
  { name: "Blikk Rapport Tid Lathund 5", file: "/documents/BLIKK rapportera tid LATHUND-5.png" },
];

const infoSections = [
  {
    name: "Försäkring Lastbil",
    content: (
      <span>
        Vid olycka med lastbil under Entreprenad så har vi försäkring på alla lastbilar som heter Protector
        försäkring och dom använder sig av Assistancekåren
        <br />
        Protector försäkring:{" "}
        <a href="tel:0841063700" className="font-semibold text-emerald-700 underline hover:text-emerald-800">08-410 637 00</a>
      </span>
    ),
  },
  {
    name: "Fallskydd ",
    content: (
      <span>
        Vi innehar taksäkerhetsselar för våra anställdas säkerhet.<br /> Det skall finnas ett sele-kit per bil. Dessa
        kit skall besiktigas en gång per år, <br />
        Patrik har koll på när. Dock ansvarar varje team att se till att det kommer in till wurth som besiktigar våra
        selar <br /> och återhämtar dom när det är dax. <br /> När detta är gjort så är det <strong>extremt viktigt</strong> att
        ni meddelar Patrik när ni har hämtat selen åter.
      </span>
    ),
  },
];

function AccordionCard({ title, children, defaultOpen }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className={cn(crm.card, 'group')} {...(defaultOpen ? { open: true } : {})}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3">
        <span className="text-sm font-bold tracking-tight text-slate-900">{title}</span>
        <svg className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="border-t border-[#e0e8dc] px-3.5 py-3.5 text-sm leading-6 text-slate-700">{children}</div>
    </details>
  );
}

function DocImage({ name, file }: { name: string; file: string }) {
  return (
    <div className="grid gap-2">
      <div className="text-[13px] font-semibold text-slate-900">{name}</div>
      <img src={file} alt={name} className="max-w-full rounded-lg border border-[#e3e9df]" />
      <a href={file} download className="w-fit text-[13px] font-semibold text-emerald-700 underline hover:text-emerald-800">Ladda ner</a>
    </div>
  );
}

export default function DokumentInformationPage() {
  const densitetDoc = imageDocuments.find((d) => d.name.toLowerCase().includes("densitet"));
  const lathundDoc = imageDocuments.find((d) => d.name.toLowerCase().includes("lathund"));
  const blikkTimeDocs = imageDocuments.filter((doc) => {
    const n = doc.name.toLowerCase();
    return n.includes('blikk rapport tid lathund') || n.includes('rapportera tid i blikk');
  });

  return (
    <div className="mx-auto grid w-full max-w-[900px] grid-cols-1 gap-4">
      <div>
        <h1 className="m-0 text-lg font-bold tracking-tight text-slate-900">Dokument & information</h1>
        <p className="m-0 mt-1 text-sm text-slate-500">Viktiga dokument och instruktioner för personalen.</p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <p className={crm.sectionTitle}>Bilder</p>
        {densitetDoc && <AccordionCard title="Mall Densitet"><DocImage {...densitetDoc} /></AccordionCard>}
        {lathundDoc && <AccordionCard title="Lathund Isolering"><DocImage {...lathundDoc} /></AccordionCard>}
        {blikkTimeDocs.length > 0 && (
          <AccordionCard title="Rapportera tid i Blikk">
            <div className="grid gap-6">
              {blikkTimeDocs.map((doc) => (
                <DocImage key={doc.file} {...doc} />
              ))}
            </div>
          </AccordionCard>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3">
        <p className={crm.sectionTitle}>Information</p>
        {infoSections.map((info) => (
          <AccordionCard key={info.name} title={info.name.trim()}>{info.content}</AccordionCard>
        ))}
      </div>
    </div>
  );
}
