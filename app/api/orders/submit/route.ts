import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const SubmitSchema = z.object({
  orderId: z.string().min(1),
  projectNumber: z.string().optional(),
  installerName: z.string().min(1),
  workAddress: z.object({
    streetAddress: z.string().min(1),
    postalCode: z.string().min(1),
    city: z.string().min(1),
  }),
  installationDate: z.string().refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), 'Use YYYY-MM-DD'),
  clientName: z.string().min(1),
  materialUsed: z.string().optional(),
  etapperOpen: z.array(z.object({
    etapp: z.string().optional(),
    ytaM2: z.string().optional(),
    bestalldTjocklek: z.string().optional(),
    sattningsprocent: z.string().optional(),
    installeradTjocklek: z.string().optional(),
    installeradDensitet: z.string().optional(),
    antalSack: z.string().optional(),
    lambdavarde: z.string().optional(),
  })).optional(),
  etapperClosed: z.array(z.object({
    etapp: z.string().optional(),
    ytaM2: z.string().optional(),
    bestalldTjocklek: z.string().optional(),
    uppmatTjocklek: z.string().optional(),
    installeradDensitet: z.string().optional(),
    antalSackKgPerSack: z.string().optional(),
    lambdavarde: z.string().optional(),
  })).optional(),
  checks: z.object({
    takfotsventilation: z.object({ ok: z.boolean(), comment: z.string().optional() }),
    snickerier: z.object({ ok: z.boolean(), comment: z.string().optional() }),
    tatskikt: z.object({ ok: z.boolean(), comment: z.string().optional() }),
  }).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const data = SubmitSchema.parse(json);

    // Placeholder: hook integration or persistence here
    // For now, just echo back so you can wire frontend flow
  return NextResponse.json({ ok: true, received: data }, { status: 200 });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return NextResponse.json({ error: 'Validation failed', issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
