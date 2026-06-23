import { FbClient, FbInvoice } from '../freshbooks/freshbooks.types';
import {
  mapClientToCustomer,
  mapInvoiceToInvoice,
  moneyToCents,
  toExternalCustomerId,
  toExternalInvoiceId,
} from './mappers';

describe('external id helpers', () => {
  it('builds customer + invoice external ids', () => {
    expect(toExternalCustomerId(42)).toBe('fb_client_42');
    expect(toExternalInvoiceId(987)).toBe('fb_invoice_987');
  });
});

describe('moneyToCents', () => {
  it.each([
    ['500.00', 50000],
    ['120.99', 12099],
    ['0.01', 1],
    ['0', 0],
    ['', 0],
    [undefined, 0],
    ['10.005', 1001], // rounds half up
  ])('converts %p -> %p cents', (input, expected) => {
    expect(moneyToCents(input as string)).toBe(expected);
  });
});

describe('mapClientToCustomer', () => {
  const base: FbClient = {
    id: 220399,
    userid: 220399,
    fname: 'Melville',
    lname: 'DMello',
    email: 'client@example.com',
    organization: 'Your Client B.V',
    currency_code: 'EUR',
    vat_number: 'NL123456789',
    p_street: '123 Main St',
    p_city: 'Amsterdam',
    p_province: 'NH',
    p_code: '1011',
    p_country: 'Netherlands',
    vis_state: 0,
    updated: '2021-11-05 13:56:17',
  };

  it('maps organization, vat, address and a main contact', () => {
    const out = mapClientToCustomer(base);
    expect(out.externalId).toBe('fb_client_220399');
    expect(out.name).toBe('Your Client B.V');
    expect(out.vatNumber).toBe('NL123456789');
    expect(out.address).toEqual({
      address: '123 Main St',
      zipcode: '1011',
      city: 'Amsterdam',
      state: 'NH',
      country: 'Netherlands',
    });
    expect(out.contacts).toEqual([
      {
        email: 'client@example.com',
        firstName: 'Melville',
        lastName: 'DMello',
        isMain: true,
      },
    ]);
  });

  it('falls back to full name when no organization', () => {
    const out = mapClientToCustomer({ ...base, organization: '' });
    expect(out.name).toBe('Melville DMello');
  });

  it('omits contacts and address when absent', () => {
    const out = mapClientToCustomer({
      ...base,
      organization: 'Acme',
      email: '',
      p_street: null,
      p_street2: null,
      p_city: null,
      p_province: null,
      p_code: null,
      p_country: null,
    });
    expect(out.contacts).toBeUndefined();
    expect(out.address).toBeUndefined();
  });
});

describe('mapInvoiceToInvoice', () => {
  const base: FbInvoice = {
    id: 12345,
    invoiceid: 12345,
    invoice_number: 'INV-0001',
    status: 2,
    v3_status: 'sent',
    customerid: 220399,
    currency_code: 'EUR',
    amount: { amount: '605.00', code: 'EUR' },
    create_date: '2024-03-01',
    due_date: '2024-03-31',
    updated: '2024-03-05 14:22:10',
    vis_state: 0,
    lines: [
      {
        name: 'Consulting',
        qty: '10',
        unit_cost: { amount: '50.00', code: 'EUR' },
        taxName1: 'VAT',
        taxAmount1: '21',
      },
    ],
  };

  it('maps ids, dates, currency and amounts in cents', () => {
    const out = mapInvoiceToInvoice(base);
    expect(out.customId).toBe('INV-0001');
    expect(out.externalId).toBe('fb_invoice_12345');
    expect(out.issuedAt).toBe('2024-03-01T00:00:00Z');
    expect(out.dueDate).toBe('2024-03-31T00:00:00Z');
    expect(out.currency).toBe('EUR');
    expect(out.customer).toEqual({ externalId: 'fb_client_220399' });
    expect(out.grossAmount).toBe(60500);
    // tax = 500.00 * 21% = 105.00 -> net = 605 - 105 = 500.00
    expect(out.netAmount).toBe(50000);
  });

  it('falls back dueDate to issuedAt when due_date missing', () => {
    const out = mapInvoiceToInvoice({ ...base, due_date: null });
    expect(out.dueDate).toBe('2024-03-01T00:00:00Z');
  });

  it('net equals gross when no tax lines', () => {
    const out = mapInvoiceToInvoice({
      ...base,
      amount: { amount: '500.00', code: 'EUR' },
      lines: [],
    });
    expect(out.grossAmount).toBe(50000);
    expect(out.netAmount).toBe(50000);
  });
});
