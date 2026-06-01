import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { crmCallSelect } from './calls';
import { crmProspectSelect } from './prospects';
import { crmQuoteSelect } from './quotes';

type CoachContextRef = {
  type: 'prospect' | 'call' | 'quote';
  id: string;
};

export type CoachContextSummary = {
  type: CoachContextRef['type'];
  id: string;
  label: string;
  summary: string[];
};

export type CoachReply = {
  mode: 'mock' | 'ai';
  headline: string;
  lead: string;
  strategy: string[];
  talk_track: string[];
  next_steps: string[];
  context: CoachContextSummary | null;
};

type CallProspect = {
  id: string;
  company_name: string;
};

type QuoteProspect = {
  id: string;
  company_name: string;
};

type ProspectRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  city: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
  source: string | null;
};

type CallRow = {
  id: string;
  prospect_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  source: string | null;
  outcome: 'no_answer' | 'follow_up' | 'positive' | 'negative';
  summary: string;
  next_step: string | null;
  prospect: CallProspect | CallProspect[] | null;
};

type QuoteRow = {
  id: string;
  prospect_id: string | null;
  customer_name: string | null;
  project_name: string;
  status: 'draft' | 'sent' | 'follow_up' | 'won' | 'lost';
  follow_up_date: string | null;
  prospect: QuoteProspect | QuoteProspect[] | null;
};

type BuildMockCoachReplyArgs = {
  prompt: string;
  quickAction: string | null;
  context: CoachContextSummary | null;
  userName: string | null;
};

type GenerateCoachReplyArgs = BuildMockCoachReplyArgs;

const coachReplySchema = z.object({
  headline: z.string().trim().min(1).max(160),
  lead: z.string().trim().min(1).max(500),
  strategy: z.array(z.string().trim().min(1).max(280)).min(3).max(3),
  talk_track: z.array(z.string().trim().min(1).max(280)).min(3).max(3),
  next_steps: z.array(z.string().trim().min(1).max(220)).min(3).max(3),
});

type CoachModelConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  authHeader: string;
};

type OpenAiCompatibleResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

const prospectStatusLabel: Record<ProspectRow['status'], string> = {
  new: 'Ny',
  contacted: 'Kontaktad',
  qualified: 'Kvalificerad',
  quoted: 'Offert',
  won: 'Vunnen',
  lost: 'Förlorad',
};

const quoteStatusLabel: Record<QuoteRow['status'], string> = {
  draft: 'Utkast',
  sent: 'Skickad',
  follow_up: 'Följ upp',
  won: 'Vunnen',
  lost: 'Förlorad',
};

const callOutcomeLabel: Record<CallRow['outcome'], string> = {
  no_answer: 'Ej svar',
  follow_up: 'Följ upp',
  positive: 'Positivt',
  negative: 'Negativt',
};

function getProspectFromCall(item: CallRow) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getProspectFromQuote(item: QuoteRow) {
  if (Array.isArray(item.prospect)) return item.prospect[0] || null;
  return item.prospect || null;
}

function getCallLabel(item: CallRow) {
  return getProspectFromCall(item)?.company_name || item.company_name || 'Fristående samtal';
}

function getQuoteLabel(item: QuoteRow) {
  return getProspectFromQuote(item)?.company_name || item.customer_name || item.project_name;
}

function buildProspectContext(item: ProspectRow): CoachContextSummary {
  return {
    type: 'prospect',
    id: item.id,
    label: item.company_name,
    summary: [
      item.contact_name ? `Kontakt: ${item.contact_name}` : null,
      item.city ? `Ort: ${item.city}` : null,
      `Status: ${prospectStatusLabel[item.status]}`,
      item.source ? `Källa: ${item.source}` : null,
    ].filter(Boolean) as string[],
  };
}

function buildCallContext(item: CallRow): CoachContextSummary {
  return {
    type: 'call',
    id: item.id,
    label: getCallLabel(item),
    summary: [
      item.contact_name ? `Kontakt: ${item.contact_name}` : null,
      `Utfall: ${callOutcomeLabel[item.outcome]}`,
      item.next_step ? `Nästa steg: ${item.next_step}` : null,
      item.source ? `Källa: ${item.source}` : null,
      item.summary ? `Senaste notis: ${item.summary}` : null,
    ].filter(Boolean) as string[],
  };
}

function buildQuoteContext(item: QuoteRow): CoachContextSummary {
  return {
    type: 'quote',
    id: item.id,
    label: getQuoteLabel(item),
    summary: [
      `Projekt: ${item.project_name}`,
      `Status: ${quoteStatusLabel[item.status]}`,
      item.follow_up_date ? `Uppföljning: ${item.follow_up_date}` : null,
    ].filter(Boolean) as string[],
  };
}

export async function loadCoachContext(supabase: SupabaseClient, ref: CoachContextRef) {
  if (ref.type === 'prospect') {
    const result = await supabase.from('crm_prospects').select(crmProspectSelect).eq('id', ref.id).single();
    return {
      data: result.data ? buildProspectContext(result.data as ProspectRow) : null,
      error: result.error,
    };
  }

  if (ref.type === 'call') {
    const result = await supabase.from('crm_calls').select(crmCallSelect).eq('id', ref.id).single();
    return {
      data: result.data ? buildCallContext(result.data as CallRow) : null,
      error: result.error,
    };
  }

  const result = await supabase.from('crm_quotes').select(crmQuoteSelect).eq('id', ref.id).single();
  return {
    data: result.data ? buildQuoteContext(result.data as QuoteRow) : null,
    error: result.error,
  };
}

function resolveScenario(quickAction: string | null, prompt: string) {
  if (quickAction) return quickAction;

  const normalized = prompt.toLowerCase();
  if (normalized.includes('dyr') || normalized.includes('invänd')) return 'handle_objection';
  if (normalized.includes('uppfölj') || normalized.includes('sms') || normalized.includes('mejl')) return 'write_follow_up';
  if (normalized.includes('samtal') || normalized.includes('ringer')) return 'next_call';
  if (normalized.includes('motivation') || normalized.includes('fokus')) return 'motivation';
  return 'close_sale';
}

function getCoachModelConfig(): CoachModelConfig | null {
  const apiUrl = process.env.COACH_AI_API_URL?.trim();
  const apiKey = process.env.COACH_AI_API_KEY?.trim();
  const model = process.env.COACH_AI_MODEL?.trim();

  if (!apiUrl || !apiKey || !model) return null;

  return {
    apiUrl,
    apiKey,
    model,
    authHeader: process.env.COACH_AI_AUTH_HEADER?.trim() || 'Authorization',
  };
}

// Keep the provider contract here so Coach can switch from mock fallback to a live
// model without touching the client flow. Activation details and rollout notes live in
// /Users/williamali/BlikkIntegration_ekovilla/plan-crm-feature.md.

function buildContextPrompt(context: CoachContextSummary | null) {
  if (!context) return 'Ingen specifik CRM-kontext vald.';
  return [`Typ: ${context.type}`, `Rubrik: ${context.label}`, ...context.summary].join('\n');
}

function buildSystemPrompt() {
  return [
    'Du är en svensk AI-säljcoach för Ekovilla CRM.',
    'Svara alltid på svenska.',
    'Fokusera på konkret coaching för nästa steg i säljdialogen.',
    'Var tydlig, trygg och framåtriktad. Undvik fluff, intern systemtext och generiska dashboard-formuleringar.',
    'Returnera endast strikt JSON med nycklarna headline, lead, strategy, talk_track och next_steps.',
    'strategy, talk_track och next_steps måste vara arrayer med exakt tre korta strängar vardera.',
    'headline ska vara en kort coachrubrik i mening eller frasform.',
    'lead ska vara 1-2 meningar som sammanfattar hur säljaren bör tänka i just läget.',
    'talk_track ska vara formuleringar säljaren faktiskt kan säga till kund.',
    'Nämn inte att du är en AI-modell och skriv inte markdown.',
  ].join(' ');
}

function buildUserPrompt(args: GenerateCoachReplyArgs) {
  const scenario = resolveScenario(args.quickAction, args.prompt);

  return [
    `Säljare: ${args.userName || 'okänd användare'}`,
    `Scenario: ${scenario}`,
    args.quickAction ? `Snabbval: ${args.quickAction}` : 'Snabbval: inget',
    `Fråga: ${args.prompt}`,
    'CRM-kontext:',
    buildContextPrompt(args.context),
  ].join('\n\n');
}

function extractMessageContent(payload: OpenAiCompatibleResponse) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((item) => item?.type === 'text' && item.text)
      .map((item) => item.text)
      .join('\n')
      .trim();
  }
  return '';
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function generateModelCoachReply(args: GenerateCoachReplyArgs, config: CoachModelConfig): Promise<CoachReply> {
  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [config.authHeader]: config.authHeader.toLowerCase() === 'authorization' ? `Bearer ${config.apiKey}` : config.apiKey,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(args) },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Okänt modellfel');
    throw new Error(`Coach-modellen svarade med ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const payload = (await response.json().catch(() => null)) as OpenAiCompatibleResponse | null;
  const rawContent = payload ? extractMessageContent(payload) : '';
  const parsed = rawContent ? safeJsonParse(rawContent) : null;
  const validated = coachReplySchema.safeParse(parsed);

  if (!validated.success) {
    throw new Error('Coach-modellen returnerade ett svar som inte matchade JSON-schemat.');
  }

  return {
    mode: 'ai',
    headline: validated.data.headline,
    lead: validated.data.lead,
    strategy: validated.data.strategy,
    talk_track: validated.data.talk_track,
    next_steps: validated.data.next_steps,
    context: args.context,
  };
}

export async function generateCoachReply(args: GenerateCoachReplyArgs): Promise<CoachReply> {
  const config = getCoachModelConfig();
  if (!config) return buildMockCoachReply(args);

  try {
    return await generateModelCoachReply(args, config);
  } catch (error) {
    console.error('[crm/coach] Falling back to mock reply', error);
    return buildMockCoachReply(args);
  }
}

export function buildMockCoachReply(args: BuildMockCoachReplyArgs): CoachReply {
  const scenario = resolveScenario(args.quickAction, args.prompt);
  const contextLead = args.context
    ? `Utgå från ${args.context.label} och håll svaret nära den faktiska situationen i CRM.`
    : 'Ingen CRM-kontext är vald, så rådet blir mer generellt och säljbeteende-orienterat.';
  const nameLead = args.userName ? `${args.userName}, ` : '';

  if (scenario === 'handle_objection') {
    return {
      mode: 'mock' as const,
      headline: `${nameLead}börja med att avväpna invändningen`,
      lead: `${contextLead} Bekräfta kundens tvekan först, och flytta sedan samtalet från pris till värde, risk eller trygghet.`,
      strategy: [
        'Svara inte med försvar direkt. Visa att du förstår kundens tvekan innan du försöker övertyga.',
        'Ställ en förtydligande fråga så att du får veta om invändningen gäller pris, timing eller osäkerhet.',
        'Knyt tillbaka till det kunden faktiskt vill uppnå i stället för att fastna i rabattsnack.',
      ],
      talk_track: [
        'Jag förstår att det känns som ett stort beslut. Vad är det främst du vill känna dig trygg med innan du går vidare?',
        'Om vi lägger själva prislappen åt sidan en stund, vad är viktigast för dig att få rätt här?',
        'Det viktiga för mig är inte att pressa fram ett ja, utan att du känner att lösningen faktiskt håller över tid.',
      ],
      next_steps: [
        'Identifiera den egentliga invändningen innan du argumenterar.',
        'Sammanfatta kundens tvekan med dina egna ord.',
        'Be om ett mindre nästa steg om kunden inte är redo för beslut direkt.',
      ],
      context: args.context,
    };
  }

  if (scenario === 'write_follow_up') {
    return {
      mode: 'mock' as const,
      headline: `${nameLead}håll uppföljningen kort och framåtriktad`,
      lead: `${contextLead} En bra uppföljning ska kännas personlig, lätt att svara på och tydlig i vilket nästa steg du vill få till.`,
      strategy: [
        'Börja med något specifikt från senaste kontakten så att texten inte känns massutskickad.',
        'Sikta på ett enda tydligt nästa steg i stället för flera val samtidigt.',
        'Låt tonen vara varm och trygg hellre än säljpressad.',
      ],
      talk_track: [
        'Hej! Jag tänkte bara följa upp vår senaste kontakt och höra hur du tänker just nu.',
        'Om det känns relevant kan vi ta ett kort avstämningssamtal och reda ut det som återstår innan beslut.',
        'Återkom gärna med det som känns mest oklart, så hjälper jag dig vidare därifrån.',
      ],
      next_steps: [
        'Välj sms eller mejl beroende på hur personlig senaste kontakten var.',
        'Be om ett litet svar eller en enkel tid, inte ett stort beslut direkt.',
        'Sätt ett eget uppföljningsdatum om kunden inte svarar.',
      ],
      context: args.context,
    };
  }

  if (scenario === 'next_call') {
    return {
      mode: 'mock' as const,
      headline: `${nameLead}gå in i nästa samtal med tydligt syfte`,
      lead: `${contextLead} Nästa samtal bör kännas som ett lugnt steg framåt, inte som en kontrollfråga om kunden har bestämt sig ännu.`,
      strategy: [
        'Bestäm på förhand vilket resultat du vill ha av samtalet: beslut, förtydligande eller nästa möte.',
        'Öppna med trygghet och sammanhang, inte med direkt press på ja eller nej.',
        'Ställ frågor som hjälper kunden formulera sitt eget beslut.',
      ],
      talk_track: [
        'Jag tänkte att vi tar en kort avstämning så att du kan få svar på det som återstår innan du bestämmer dig.',
        'Vad väger tyngst för dig just nu när du funderar vidare?',
        'Om du skulle känna dig helt trygg i beslutet, vad skulle du behöva ha klart för dig först?',
      ],
      next_steps: [
        'Skriv ner två frågor du absolut vill få svar på under samtalet.',
        'Förbered en tydlig avslutning: beslut nu eller nytt konkret nästa steg.',
        'Logga direkt efteråt vad kunden faktiskt sa, inte bara din tolkning.',
      ],
      context: args.context,
    };
  }

  if (scenario === 'motivation') {
    return {
      mode: 'mock' as const,
      headline: `${nameLead}fokusera på nästa riktiga rörelse`,
      lead: `${contextLead} Målet i ett säljpass är inte att känna maximal energi hela tiden, utan att skapa nästa tydliga framsteg i rätt samtal.`,
      strategy: [
        'Välj ett mindre delmål för passet, till exempel tre bra samtal eller två tydliga uppföljningar.',
        'Mät kvalitet i aktivitet, inte bara antal kontakter.',
        'Behåll lugn och riktning även när ett samtal inte landar som du ville.',
      ],
      talk_track: [
        'Jag behöver inte vinna allt i det här samtalet. Jag behöver flytta det framåt.',
        'Min uppgift är att skapa klarhet och trygghet, inte att pressa fram ett svar.',
        'Varje bra kontakt bygger momentum även om avslutet kommer lite senare.',
      ],
      next_steps: [
        'Välj ett enda snabbval eller en fråga och kör första coachrundan innan nästa samtal.',
        'Ta den kontakt som du vet att du skjutit på först.',
        'Logga vad som fungerade direkt efter passet så att du bygger egen säljrytm.',
      ],
      context: args.context,
    };
  }

  return {
    mode: 'mock' as const,
    headline: `${nameLead}stäng genom tydlighet, inte genom tryck`,
    lead: `${contextLead} När du vill få affären i mål är det oftast bättre att skapa beslutsklarhet än att försöka sälja hårdare i slutet.`,
    strategy: [
      'Sammanfatta det kunden redan sagt är viktigt innan du ber om beslut.',
      'Testa ett lugnt avslut som gör det lätt för kunden att välja riktning.',
      'Om kunden tvekar, flytta samtalet till vad som fortfarande saknas för att kunna ta nästa steg.',
    ],
    talk_track: [
      'Utifrån det vi gått igenom låter det som att lösningen möter det du vill få ut. Känns det som att nästa steg är rätt nu?',
      'Vad skulle du behöva känna dig helt trygg med för att kunna gå vidare?',
      'Om vi tar nästa steg tillsammans nu, känns det som rätt timing för dig?',
    ],
    next_steps: [
      'Be om beslut eller tydligt nästa steg innan samtalet avslutas.',
      'Om kunden tvekar, ringa in exakt vad tvekan består av.',
      'Skicka en kort uppföljning direkt efter samtalet medan energin är kvar.',
    ],
    context: args.context,
  };
}