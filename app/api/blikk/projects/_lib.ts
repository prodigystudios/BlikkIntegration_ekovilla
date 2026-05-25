import { NextResponse } from 'next/server';
import { z } from 'zod';

export const projectIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const updateProjectBodySchema = z.object({
  description: z.string(),
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

export function extractProjectDetails(data: any, id: number, includeRaw = false) {
  const candidates: number[] = [];
  const pushNum = (value: unknown) => {
    if (value != null && value !== '' && Number.isFinite(Number(value))) {
      candidates.push(Number(value));
    }
  };

  if (data) {
    pushNum(data.customerId);
    pushNum(data.contactId);
    pushNum(data.clientId);
    pushNum(data.ClientId);
    pushNum(data.CustomerId);
    pushNum(data.customerID);
    pushNum(data.CustomerID);
    pushNum(data.customer_id);
    pushNum(data.contact_id);

    const nestedObjects = [data.customer, data.contact, data.client, data.owner, data.company, data.organisation, data.organization];
    for (const nested of nestedObjects) {
      if (!nested || typeof nested !== 'object') continue;
      pushNum(nested.id);
      pushNum(nested.Id);
      pushNum(nested.customerId);
    }
  }

  const addressObj = data?.address || data?.Address || null;
  const street = addressObj?.street || addressObj?.Street || data?.street || data?.addressLine1 || data?.Address1 || data?.line1 || null;
  const postalCode = addressObj?.postalCode || addressObj?.Zip || data?.postalCode || data?.zip || data?.zipCode || data?.postal || null;
  const city = addressObj?.city || addressObj?.City || data?.city || data?.town || data?.locality || null;
  const address = [street, postalCode, city].filter(Boolean).join(', ') || null;
  const description = data?.description || data?.notes || data?.note || data?.comment || data?.projectDescription || null;
  const status = (() => {
    const rawStatus: any = data?.status || data?.state;
    if (!rawStatus) return null;
    if (typeof rawStatus === 'string') return rawStatus;
    if (typeof rawStatus === 'object') return rawStatus.name || rawStatus.title || rawStatus.status || null;
    return null;
  })();
  const salesResponsible = (() => {
    const rawSalesResponsible: any = data?.salesResponsible || data?.salesResponsibleUser || data?.salesUser || data?.salesRep || data?.responsibleSalesUser;
    if (Array.isArray(rawSalesResponsible)) {
      return rawSalesResponsible.map((entry) => (entry && (entry.name || entry.fullName || entry.title)) || '').filter(Boolean).join(', ') || null;
    }
    if (typeof rawSalesResponsible === 'string') return rawSalesResponsible;
    if (rawSalesResponsible && typeof rawSalesResponsible === 'object') {
      return rawSalesResponsible.name || rawSalesResponsible.fullName || rawSalesResponsible.title || null;
    }
    return data?.salesResponsibleName || data?.salesResponsibleFullName || null;
  })();

  const response: any = {
    customerId: candidates.find((value) => value > 0) ?? null,
    project: {
      id: String(id),
      name: data?.title || data?.name || data?.projectName || data?.orderName || null,
      orderNumber: data?.orderNumber || data?.projectNumber || data?.number || null,
      salesResponsible,
      status,
      street,
      postalCode,
      city,
      address,
      description,
    },
  };

  if (includeRaw) {
    response.raw = data;
  }

  return response;
}