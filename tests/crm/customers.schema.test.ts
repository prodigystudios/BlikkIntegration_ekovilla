import { describe, it, expect } from 'vitest';
import {
  createCrmCustomerSchema,
  updateCrmCustomerSchema,
  listCrmCustomersQuerySchema,
  createCrmCustomerContactSchema,
} from '@/app/api/crm/customers/_lib';

// ---------------------------------------------------------------------------
// createCrmCustomerSchema
// ---------------------------------------------------------------------------

describe('createCrmCustomerSchema', () => {
  describe('företagskund (business)', () => {
    it('godkänner giltig input', () => {
      const result = createCrmCustomerSchema.safeParse({
        customer_type: 'business',
        company_name: 'Acme AB',
      });
      expect(result.success).toBe(true);
    });

    it('misslyckas utan company_name', () => {
      const result = createCrmCustomerSchema.safeParse({
        customer_type: 'business',
      });
      expect(result.success).toBe(false);
    });

    it('misslyckas med tom company_name', () => {
      const result = createCrmCustomerSchema.safeParse({
        customer_type: 'business',
        company_name: '   ',
      });
      // Trimmas till tom sträng → refine-check misslyckas
      expect(result.success).toBe(false);
    });

    it('sätter default customer_stage till customer', () => {
      const result = createCrmCustomerSchema.safeParse({
        customer_type: 'business',
        company_name: 'Acme AB',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.customer_stage).toBe('customer');
      }
    });

    it('godkänner explicit customer_stage prospect', () => {
      const result = createCrmCustomerSchema.safeParse({
        customer_type: 'business',
        company_name: 'Acme AB',
        customer_stage: 'prospect',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('privatkund (private)', () => {
    it('godkänner giltig input', () => {
      const result = createCrmCustomerSchema.safeParse({
        customer_type: 'private',
        first_name: 'Anna',
        last_name: 'Svensson',
      });
      expect(result.success).toBe(true);
    });

    it('misslyckas utan last_name', () => {
      const result = createCrmCustomerSchema.safeParse({
        customer_type: 'private',
        first_name: 'Anna',
      });
      expect(result.success).toBe(false);
    });

    it('misslyckas utan first_name', () => {
      const result = createCrmCustomerSchema.safeParse({
        customer_type: 'private',
        last_name: 'Svensson',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('okänd customer_type', () => {
    it('misslyckas med ogiltig typ', () => {
      const result = createCrmCustomerSchema.safeParse({
        customer_type: 'unknown',
        company_name: 'Test',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('adressfält', () => {
    it('godkänner giltig visit_address', () => {
      const result = createCrmCustomerSchema.safeParse({
        customer_type: 'business',
        company_name: 'Test AB',
        visit_address: { street: 'Storgatan 1', postal_code: '12345', city: 'Stockholm' },
      });
      expect(result.success).toBe(true);
    });

    it('sätter address till null som default', () => {
      const result = createCrmCustomerSchema.safeParse({
        customer_type: 'business',
        company_name: 'Test AB',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.visit_address).toBeNull();
        expect(result.data.invoice_address).toBeNull();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// updateCrmCustomerSchema
// ---------------------------------------------------------------------------

describe('updateCrmCustomerSchema', () => {
  it('godkänner partiell uppdatering', () => {
    const result = updateCrmCustomerSchema.safeParse({ status: 'inactive' });
    expect(result.success).toBe(true);
  });

  it('godkänner tom body (alla fält valfria)', () => {
    const result = updateCrmCustomerSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('misslyckas med ogiltigt status-värde', () => {
    const result = updateCrmCustomerSchema.safeParse({ status: 'deleted' });
    expect(result.success).toBe(false);
  });

  it('misslyckas med icke-UUID assigned_to', () => {
    const result = updateCrmCustomerSchema.safeParse({ assigned_to: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('godkänner giltig UUID för assigned_to', () => {
    const result = updateCrmCustomerSchema.safeParse({
      assigned_to: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listCrmCustomersQuerySchema
// ---------------------------------------------------------------------------

describe('listCrmCustomersQuerySchema', () => {
  it('godkänner tom query', () => {
    const result = listCrmCustomersQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('godkänner alla giltiga filter', () => {
    const result = listCrmCustomersQuerySchema.safeParse({
      q: 'sök',
      status: 'active',
      stage: 'prospect',
      assigned_to: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('misslyckas med ogiltigt stage', () => {
    const result = listCrmCustomersQuerySchema.safeParse({ stage: 'fel' });
    expect(result.success).toBe(false);
  });

  it('misslyckas med icke-UUID assigned_to', () => {
    const result = listCrmCustomersQuerySchema.safeParse({ assigned_to: 'ej-uuid' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createCrmCustomerContactSchema
// ---------------------------------------------------------------------------

describe('createCrmCustomerContactSchema', () => {
  it('godkänner minimal giltig kontakt', () => {
    const result = createCrmCustomerContactSchema.safeParse({ name: 'Erik Lindgren' });
    expect(result.success).toBe(true);
  });

  it('misslyckas med tom name', () => {
    const result = createCrmCustomerContactSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('misslyckas med ogiltig e-post', () => {
    const result = createCrmCustomerContactSchema.safeParse({
      name: 'Test',
      email: 'inte-en-email',
    });
    expect(result.success).toBe(false);
  });

  it('godkänner giltig e-post', () => {
    const result = createCrmCustomerContactSchema.safeParse({
      name: 'Test',
      email: 'test@example.com',
    });
    expect(result.success).toBe(true);
  });
});
