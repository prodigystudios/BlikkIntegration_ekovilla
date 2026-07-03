import { z } from 'zod';
import { FAULT_CATEGORIES, FAULT_STATUSES } from './types';

export const createFaultReportSchema = z.object({
  category: z.enum(FAULT_CATEGORIES, { errorMap: () => ({ message: 'Välj vad felanmälan gäller' }) }),
  comment: z.string().trim().min(1, 'Beskriv vad som är fel'),
});

export type CreateFaultReportInput = z.infer<typeof createFaultReportSchema>;

// Supervisor update: status is required, reply optional (empty → null).
export const updateFaultReportSchema = z.object({
  status: z.enum(FAULT_STATUSES, { errorMap: () => ({ message: 'Ogiltig status' }) }),
  reply: z.preprocess((v) => {
    if (v == null) return null;
    const t = String(v).trim();
    return t.length > 0 ? t : null;
  }, z.string().nullable()).optional().default(null),
});

export type UpdateFaultReportInput = z.infer<typeof updateFaultReportSchema>;

// Query for the list route.
export const listFaultReportsQuerySchema = z.object({
  scope: z.enum(['mine', 'inbox']).optional().default('mine'),
  status: z.enum(FAULT_STATUSES).optional(),
});

export type ListFaultReportsQuery = z.infer<typeof listFaultReportsQuerySchema>;
