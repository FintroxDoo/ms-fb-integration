import {
  FbClient,
  FbInvoice,
  FbInvoiceLine,
} from '../freshbooks/freshbooks.types';
import {
  UpflowCustomerInput,
  UpflowInvoiceInput,
} from '../upflow/upflow.types';

// --- external id helpers (idempotency keys) ---

export function toExternalCustomerId(fbClientId: number | string): string {
  return `fb_client_${fbClientId}`;
}

export function toExternalInvoiceId(fbInvoiceId: number | string): string {
  return `fb_invoice_${fbInvoiceId}`;
}

// --- money: FreshBooks decimal string -> UpFlow integer cents ---

export function moneyToCents(amount: string | undefined | null): number {
  if (!amount) return 0;
  const value = parseFloat(amount);
  if (Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

/** Subtotal of a line in cents: explicit amount, else qty * unit_cost. */
function lineSubtotalCents(line: FbInvoiceLine): number {
  if (line.amount?.amount) return moneyToCents(line.amount.amount);
  const qty = parseFloat(line.qty ?? '0');
  const unit = moneyToCents(line.unit_cost?.amount);
  if (Number.isNaN(qty)) return 0;
  return Math.round(qty * unit);
}

/** Total tax across all lines, in cents. */
function totalTaxCents(lines: FbInvoiceLine[]): number {
  let tax = 0;
  for (const line of lines) {
    const subtotal = lineSubtotalCents(line);
    const pct1 = parseFloat(line.taxAmount1 ?? '0') || 0;
    const pct2 = parseFloat(line.taxAmount2 ?? '0') || 0;
    tax += Math.round((subtotal * (pct1 + pct2)) / 100);
  }
  return tax;
}

// --- entity mappers ---

/** Treat blank/whitespace FreshBooks strings as absent. */
function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function mapClientToCustomer(client: FbClient): UpflowCustomerInput {
  const fullName = `${client.fname ?? ''} ${client.lname ?? ''}`.trim();
  const name =
    client.organization ||
    fullName ||
    client.email ||
    `Client ${client.userid}`;

  const customer: UpflowCustomerInput = {
    externalId: toExternalCustomerId(client.userid),
    name,
  };

  if (client.vat_number) {
    customer.vatNumber = client.vat_number;
  }

  const address = {
    address:
      [client.p_street, client.p_street2]
        .map(clean)
        .filter(Boolean)
        .join(', ') || undefined,
    zipcode: clean(client.p_code),
    city: clean(client.p_city),
    state: clean(client.p_province),
    country: clean(client.p_country),
  };
  if (Object.values(address).some((v) => v)) {
    customer.address = address;
  }

  // UpFlow contacts require a unique email — only attach when we have one.
  if (client.email) {
    customer.contacts = [
      {
        email: client.email,
        firstName: clean(client.fname),
        lastName: clean(client.lname),
        isMain: true,
      },
    ];
  }

  return customer;
}

export function mapInvoiceToInvoice(invoice: FbInvoice): UpflowInvoiceInput {
  const gross = moneyToCents(invoice.amount?.amount);
  const tax = totalTaxCents(invoice.lines ?? []);
  // Fall back to gross when tax can't be derived (documented assumption).
  const net = Math.max(0, gross - tax);

  const issued = `${invoice.create_date}T00:00:00Z`;
  const due = invoice.due_date ? `${invoice.due_date}T00:00:00Z` : issued;

  return {
    customId: invoice.invoice_number,
    externalId: toExternalInvoiceId(invoice.invoiceid),
    issuedAt: issued,
    dueDate: due,
    currency: invoice.currency_code,
    grossAmount: gross,
    netAmount: net,
    customer: { externalId: toExternalCustomerId(invoice.customerid) },
  };
}
