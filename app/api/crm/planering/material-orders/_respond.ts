import { describeOrderLineProblem } from '@/lib/domains/planning/materialOrders';
import { describeOrderEmailTemplateProblem } from '@/lib/domains/planning/materialOrderEmail';
import type { ComposeFailure } from '@/lib/domains/planning/materialOrdersService';
import { routeError } from '../_lib';

// Gemensamma svar för materialbeställningarnas rutter: ett ogiltigt underlag ska se likadant ut oavsett om
// det upptäcktes vid Granska, Ändra eller Skicka.
export function composeFailureResponse(failure: ComposeFailure) {
  switch (failure.kind) {
    case 'supplier_not_found':
      return routeError(404, 'material_order_supplier_not_found', 'Leverantören finns inte längre');
    case 'db_error':
      return routeError(500, 'material_order_db_error', failure.message);
    case 'invalid': {
      const messages = [
        ...failure.lineProblems.map(describeOrderLineProblem),
        ...failure.templateProblems.map((p) => `Leverantörens mall: ${describeOrderEmailTemplateProblem(p)}`),
      ];
      return routeError(400, 'material_order_invalid', messages[0] ?? 'Beställningen är ogiltig', { problems: messages });
    }
  }
}
