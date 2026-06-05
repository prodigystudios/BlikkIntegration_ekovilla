// Pure serializers that turn the quote form draft into the API payload shapes.
// Kept in a standalone (non-"use client") module so the mapping — historically the
// most regression-prone part of the quote form — is unit-testable in isolation.
//
// Inputs are narrow structural types: the form's full QuoteDraft satisfies them, so
// callers pass `draft` directly, and tests build small plain objects.

export type QuoteCustomerFields = {
  quote_type: 'private' | 'business';
  customer_name: string;
  company_name: string;
  organization_number: string;
  personal_number: string;
  contact_name: string;
  email: string;
  phone: string;
  street_address: string;
  postal_code: string;
  city: string;
  visit_address: string;
  delivery_address: string;
  invoice_address: string;
};

// The customer name used on the quote: company name for business (falling back to
// the contact name), otherwise the person's name.
export function getEffectiveCustomerName(
  d: Pick<QuoteCustomerFields, 'quote_type' | 'company_name' | 'customer_name'>,
): string {
  return d.quote_type === 'business'
    ? (d.company_name.trim() || d.customer_name.trim())
    : d.customer_name.trim();
}

// Point-in-time snapshot of the customer details, stored on every quote regardless
// of whether the customer is a saved record. Empty strings become null.
export function buildCustomerSnapshot(d: QuoteCustomerFields) {
  const effectiveCustomerName = getEffectiveCustomerName(d);
  return {
    customer_name: d.quote_type === 'private' ? d.customer_name || null : effectiveCustomerName || null,
    company_name: d.quote_type === 'business' ? d.company_name || null : null,
    organization_number: d.quote_type === 'business' ? d.organization_number || null : null,
    personal_number: d.quote_type === 'private' ? d.personal_number || null : null,
    contact_name: d.contact_name || null,
    email: d.email || null,
    phone: d.phone || null,
    street_address: d.street_address || null,
    postal_code: d.postal_code || null,
    city: d.city || null,
    visit_address: d.visit_address || null,
    delivery_address: d.delivery_address || null,
    invoice_address: d.invoice_address || null,
  };
}

export type QuoteRotFields = {
  quote_type: 'private' | 'business';
  rot_enabled: boolean;
  rot_applicant_name: string;
  rot_personal_number: string;
  rot_property_designation: string;
  rot_percent: string;
};

// ROT is only valid for private customers; everything is nulled out when disabled.
export function buildRotDetails(d: QuoteRotFields) {
  const enabled = d.quote_type === 'private' ? d.rot_enabled : false;
  return {
    enabled,
    applicant_name: enabled ? d.rot_applicant_name || null : null,
    personal_number: enabled ? d.rot_personal_number || null : null,
    property_designation: enabled ? d.rot_property_designation || null : null,
    rot_percent: enabled ? Number(d.rot_percent || '30') : 30,
  };
}

export type QuoteHandoffFields = {
  desired_installation_date: string;
  handoff_notes: string;
  work_scope: string;
};

export function buildInternalHandoff(d: QuoteHandoffFields) {
  return {
    desired_installation_date: d.desired_installation_date || null,
    handoff_notes: d.handoff_notes || null,
    work_scope: d.work_scope || null,
  };
}
