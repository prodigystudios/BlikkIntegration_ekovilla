import type { PdfBlock, PdfSection, PdfTableColumn } from '@/lib/pdf/blocks';

// KMA-planens två former: FORMULÄRET (det som fylls i på arbetsordern) och DOKUMENTET (det som
// renderas till PDF). Båda sparas på varje revision i crm_work_order_kma_plans — formuläret för att
// nästa revision ska börja där den förra slutade, dokumentet för att en omladdning ska visa exakt
// det innehåll kunden fick. Se supabase/sql/20260924_crm_work_order_kma_plans.sql.
//
// Versionsfälten (`v`, `layout`) finns för att en sparad rad ska gå att läsa även efter att formen
// ändrats: en okänd version avvisas i stället för att feltolkas.

/** En namngiven roll i organisationsblocket. E-post skrivs bara ut i bilaga 1. */
export type KmaPerson = {
  name: string;
  phone: string;
  email: string;
};

/** En rad i kontaktlistan (§2 och bilaga 7), utöver den fasta VD-raden och projektledaren. */
export type KmaContactRow = {
  name: string;
  role: string;
  phone: string;
};

/** En person som får signera egenkontroll (bilaga 8). */
export type KmaSignerRow = {
  name: string;
  role: string;
};

/** En projektspecifik risk utöver mallens — läggs till i §5 och i bilaga 1. */
export type KmaRiskRow = {
  risk: string;
  action: string;
};

/** Nycklarna i §3:s egenkontrolltabell — kolumnen "Ansvarig" är det som varierar per projekt. */
export type KmaSelfCheckKey = 'incomingMaterial' | 'density' | 'thickness' | 'airGaps' | 'finalInspection';

export type KmaFormValues = {
  v: 1;
  project: {
    projectName: string;
    customerName: string;
    /** Orderns nummer i rå form — Fortnox-numret om ordern synkats, annars AO-numret. Aldrig '#'. */
    projectNumber: string;
    /** "Fastigheter som skall isoleras" — en eller flera rader. */
    properties: string[];
    /** §1: "... vid <arbetstyp> med ...". */
    workType: string;
    /** Bilaga 8: "Åtagande". */
    commitment: string;
    /** Materialkoder ur MATERIAL_SHORTS (EKOVILLA, KNAUF SUPAFIL …). Styr materialmeningarna. */
    materials: string[];
  };
  organisation: {
    /** KMA-ansvarig / Projektledare — står också i kontaktlistan och under Godkännande. */
    projectManager: KmaPerson;
    workEnvironment: KmaPerson;
    environment: KmaPerson;
    /** "Entreprenörens kvalitetsansvarig" i bilaga 1. */
    quality: KmaPerson;
    /** §6: "Arbetsplatsronder utförs av …". */
    siteRoundsBy: string;
    /** §3: "Alla avvikelser rapporteras till …". */
    deviationRecipient: string;
  };
  selfCheckResponsible: Record<KmaSelfCheckKey, string>;
  contacts: KmaContactRow[];
  signers: {
    /** Behöriga att signera LÖPANDE egenkontroll — i regel besättningen. */
    ongoing: KmaSignerRow[];
    /** Behöriga att signera VERIFIERANDE egenkontroll — i regel arbetsledningen. */
    verifying: KmaSignerRow[];
  };
  extraRisks: KmaRiskRow[];
};

// ── Dokumentet ───────────────────────────────────────────────────────────────
//
// En platt blockmodell. Renderaren (pdf.ts) vet hur varje block ritas och bryts; dokumentbyggaren
// (document.ts) vet vad som står var. Ingen text byggs i renderaren — allt som skrivs ut finns i
// dokumentet, och det är därför det räcker att spara dokumentet för att en omladdning ska bli lika.

// Blockformen delas med skyddsronden och bor i lib/pdf/blocks.ts. Namnen här är kvar så att KMA-koden
// och den sparade dokumentformen (schemas.ts) läser som förut.
export type KmaTableColumn = PdfTableColumn;
export type KmaBlock = PdfBlock;
export type KmaSection = PdfSection;

export type KmaDocument = {
  v: 1;
  /** Renderarens version. En okänd layout kastar i stället för att ritas fel. */
  layout: 1;
  meta: {
    projectName: string;
    projectNumber: string;
    revision: number;
    issuedOn: string;
    firstIssuedOn: string;
  };
  /** Bolagsraden i foten, som i Word-mallen. */
  footer: string;
  /** Vänster i foten på varje sida: "KMA-plan · 6579 · Revision 2". */
  running: string;
  sections: KmaSection[];
};
