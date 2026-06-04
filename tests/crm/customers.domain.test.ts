import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSupabaseMock } from './helpers/supabase';
import {
  listCrmCustomers,
  createCrmCustomer,
  getCrmCustomer,
  updateCrmCustomer,
  convertProspectToCustomer,
  getCrmCustomerDisplayName,
} from '@/lib/domains/crm/customers';

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// getCrmCustomerDisplayName — ren funktion, inga mockar
// ---------------------------------------------------------------------------

describe('getCrmCustomerDisplayName', () => {
  it('returnerar company_name för business', () => {
    expect(
      getCrmCustomerDisplayName({ customer_type: 'business', company_name: 'Acme AB' })
    ).toBe('Acme AB');
  });

  it('returnerar fallback för business utan company_name', () => {
    expect(getCrmCustomerDisplayName({ customer_type: 'business', company_name: null })).toBe(
      'Okänt företag'
    );
  });

  it('returnerar för- och efternamn för private', () => {
    expect(
      getCrmCustomerDisplayName({
        customer_type: 'private',
        first_name: 'Anna',
        last_name: 'Svensson',
      })
    ).toBe('Anna Svensson');
  });

  it('returnerar fallback för private utan namn', () => {
    expect(
      getCrmCustomerDisplayName({
        customer_type: 'private',
        first_name: null,
        last_name: null,
      })
    ).toBe('Okänd kund');
  });
});

// ---------------------------------------------------------------------------
// listCrmCustomers
// ---------------------------------------------------------------------------

describe('listCrmCustomers', () => {
  it('anropar rätt tabell', async () => {
    const mockData = [{ id: 'c1', company_name: 'Test AB' }];
    const sb = makeSupabaseMock({ data: mockData, error: null });

    await listCrmCustomers(sb as any, {});

    expect(sb.from).toHaveBeenCalledWith('crm_customers');
  });

  it('returnerar data vid framgång', async () => {
    const mockData = [{ id: 'c1', company_name: 'Test AB' }];
    const sb = makeSupabaseMock({ data: mockData, error: null });

    const result = await listCrmCustomers(sb as any, {});

    expect((result as any).data).toEqual(mockData);
    expect((result as any).error).toBeNull();
  });

  it('tillämpar sökfilter via .or()', async () => {
    const sb = makeSupabaseMock({ data: [], error: null });
    const query = sb._query;

    await listCrmCustomers(sb as any, { search: 'Acme' });

    expect(query.or).toHaveBeenCalledWith(expect.stringContaining('Acme'));
  });

  it('tillämpar status-filter via .eq()', async () => {
    const sb = makeSupabaseMock({ data: [], error: null });
    const query = sb._query;

    await listCrmCustomers(sb as any, { status: 'active' });

    expect(query.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('tillämpar stage-filter via .eq()', async () => {
    const sb = makeSupabaseMock({ data: [], error: null });
    const query = sb._query;

    await listCrmCustomers(sb as any, { stage: 'prospect' });

    expect(query.eq).toHaveBeenCalledWith('customer_stage', 'prospect');
  });

  it('tillämpar assignedTo-filter via .eq()', async () => {
    const sb = makeSupabaseMock({ data: [], error: null });
    const query = sb._query;

    await listCrmCustomers(sb as any, { assignedTo: 'user-1' });

    expect(query.eq).toHaveBeenCalledWith('assigned_to', 'user-1');
  });

  it('tillämpar inga filter när options är tomma', async () => {
    const sb = makeSupabaseMock({ data: [], error: null });
    const query = sb._query;

    await listCrmCustomers(sb as any, {});

    expect(query.or).not.toHaveBeenCalled();
    expect(query.eq).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createCrmCustomer
// ---------------------------------------------------------------------------

describe('createCrmCustomer', () => {
  const validInput = {
    customer_type: 'business' as const,
    company_name: 'Nytt AB',
    assigned_to: 'user-1',
    created_by: 'user-1',
  };

  it('anropar rätt tabell med insert', async () => {
    const sb = makeSupabaseMock({ data: { id: 'new-1', ...validInput }, error: null });

    await createCrmCustomer(sb as any, validInput);

    expect(sb.from).toHaveBeenCalledWith('crm_customers');
    expect(sb._query.insert).toHaveBeenCalledWith(validInput);
  });

  it('returnerar skapad kund vid framgång', async () => {
    const created = { id: 'new-1', ...validInput };
    const sb = makeSupabaseMock({ data: created, error: null });

    const result = await createCrmCustomer(sb as any, validInput);

    expect((result as any).data).toEqual(created);
    expect((result as any).error).toBeNull();
  });

  it('returnerar error vid databasfel', async () => {
    const sb = makeSupabaseMock({ data: null, error: { message: 'unique violation' } });

    const result = await createCrmCustomer(sb as any, validInput);

    expect((result as any).error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getCrmCustomer
// ---------------------------------------------------------------------------

describe('getCrmCustomer', () => {
  it('anropar eq med rätt id', async () => {
    const sb = makeSupabaseMock({ data: { id: 'c1' }, error: null });

    await getCrmCustomer(sb as any, 'c1');

    expect(sb._query.eq).toHaveBeenCalledWith('id', 'c1');
    expect(sb._query.single).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateCrmCustomer
// ---------------------------------------------------------------------------

describe('updateCrmCustomer', () => {
  it('anropar update + eq med rätt id och data', async () => {
    const sb = makeSupabaseMock({ data: { id: 'c1', status: 'inactive' }, error: null });

    await updateCrmCustomer(sb as any, 'c1', { status: 'inactive' });

    expect(sb._query.update).toHaveBeenCalledWith({ status: 'inactive' });
    expect(sb._query.eq).toHaveBeenCalledWith('id', 'c1');
  });
});

// ---------------------------------------------------------------------------
// convertProspectToCustomer
// ---------------------------------------------------------------------------

describe('convertProspectToCustomer', () => {
  it('returnerar error när prospekt inte hittas', async () => {
    const sb = makeSupabaseMock({ data: null, error: null });

    const result = await convertProspectToCustomer(sb as any, 'missing-id', 'u1', 'u1');

    expect(result.error).toBe('Prospekt hittades inte');
    expect(result.customerId).toBeNull();
  });

  it('returnerar customerId direkt om stage redan är customer', async () => {
    const sb = makeSupabaseMock({ data: { id: 'c1', customer_stage: 'customer' }, error: null });

    const result = await convertProspectToCustomer(sb as any, 'c1', 'u1', 'u1');

    expect(result.customerId).toBe('c1');
    expect(result.error).toBeNull();
  });

  it('returnerar error vid databasfel i initial läsning', async () => {
    const sb = makeSupabaseMock({ data: null, error: { message: 'db error' } });

    const result = await convertProspectToCustomer(sb as any, 'c1', 'u1', 'u1');

    expect(result.error).toBe('db error');
  });
});
