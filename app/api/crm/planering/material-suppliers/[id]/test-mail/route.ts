import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getSupplier } from '@/lib/domains/planning/materialSuppliers';
import { DEFAULT_ORDER_EMAIL, exampleOrderEmailData, renderOrderEmail } from '@/lib/domains/planning/materialOrderEmail';
import { EmailSendError, sendEmail } from '@/lib/email';
import { ok, routeError, validationError, invalidUuidParam, requirePermission, orderEmailTestSchema } from '../../../_lib';

type RouteContext = {
  params: {
    id: string;
  };
};

// Testmail av en leverantörs beställningsmall, till DEN INLOGGADE — aldrig till fabriken.
//
// 🧨 MOTTAGAREN ÄR ALLTID DIN EGEN ADRESS, ur sessionen. Ingenting i anropet väljer den: schemat har inget
// adressfält (okända fält kastas), och leverantörens adress läses aldrig hit. En route som tar emot en
// mottagare från klienten är en öppen relä — se orderbekräftelsen, som ska lagas i en egen PR.
//
// Utkastet skickas, inte det sparade, så att en mall kan provas innan den sparas. Mailet renderas med
// exempelrader och ordernummer 0 och får ämnet "[TEST – inte skickad till fabriken]". Ingen DB-skrivning
// och ingen aktivitetslogg (loggen läses med schedule.read, se ../route.ts).
//
// ⚠️ sendEmail SKICKAR PÅ RIKTIGT i varje miljö där RESEND_API_KEY och MAIL_FROM finns — också lokalt. Det
// är därför testmailet går till dig: det är den lokala QA-vägen för mallen.
//
// SESSIONSKLIENTEN: leverantören läses med RLS (depot.manage), och auth.getUser() behöver sessionen.
export async function POST(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('planning.depot.manage');
    if (gate.response) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const parsed = orderEmailTestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const supabase = createRouteHandlerClient({ cookies });
    const { data: supplier, error } = await getSupplier(supabase, context.params.id);
    if (error) return routeError(500, 'planning_supplier_test_mail_read_failed', error.message);
    if (!supplier) return routeError(404, 'planning_supplier_not_found', 'Leverantören finns inte längre');

    const { data: auth } = await supabase.auth.getUser();
    const to = auth?.user?.email?.trim();
    if (!to) return routeError(400, 'planning_supplier_test_mail_no_address', 'Ditt konto saknar e-postadress — testmailet har ingenstans att ta vägen');

    const language = parsed.data.order_email_language;
    const template =
      parsed.data.order_email_subject && parsed.data.order_email_body
        ? { subject: parsed.data.order_email_subject, body: parsed.data.order_email_body }
        : DEFAULT_ORDER_EMAIL[language];
    const rendered = renderOrderEmail(
      template,
      language,
      exampleOrderEmailData({ name: supplier.name, contactName: supplier.contact_name }, gate.currentUser?.name?.trim() || 'Ekovilla'),
    );
    // Schemat har redan validerat mallen; det här är andra halvan av samma regel, inte en ny.
    if (!rendered.ok) return routeError(400, 'planning_supplier_test_mail_invalid_template', 'Mallen har fel — rätta dem innan du skickar ett test');

    let result;
    try {
      result = await sendEmail({
        to,
        subject: `[TEST – inte skickad till fabriken] ${rendered.email.subject}`,
        text: `Det här är ett testmail med exempelrader. Det har INTE skickats till ${supplier.name}.\n\n----------------------------------------\n\n${rendered.email.text}`,
      });
    } catch (e) {
      if (e instanceof EmailSendError) {
        return routeError(502, 'planning_supplier_test_mail_send_failed', `Testmailet kunde inte skickas: ${e.message}`);
      }
      throw e;
    }
    // Ett överhoppat utskick är inte ett skickat. Utan den här raden hade knappen sagt "skickat" i en miljö
    // där inget mail någonsin lämnade servern.
    if (result.skipped) {
      return routeError(503, 'planning_supplier_test_mail_not_configured', 'Mail är inte konfigurerat i den här miljön — inget testmail skickades');
    }

    return ok({ sent_to: to });
  } catch (e: any) {
    return routeError(500, 'planning_supplier_test_mail_unexpected', e?.message || 'Failed to send test mail');
  }
}
