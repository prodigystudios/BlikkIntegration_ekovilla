import { NextResponse } from 'next/server';
import { z } from 'zod';

export const createTaskBodySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  comment: z.string().trim().min(1),
  dueDate: z.string().optional(),
  preferredPath: z.string().optional(),
});

export const listTasksQuerySchema = z.object({
  q: z.string().optional(),
  query: z.string().optional(),
  assignedUserId: z.coerce.number().int().positive().optional(),
  assigneeId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  createdFrom: z.string().optional(),
  preferBasePath: z.enum(['true', 'false']).optional(),
  basePath: z.string().optional(),
});

export function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      legacyError: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
      ...(details !== undefined ? { details } : {}),
    },
    { status },
  );
}