// UpFlow API payload shapes. Amounts are integer cents. Upsert keyed by externalId.

export interface UpflowAddress {
  address?: string;
  zipcode?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface UpflowContactInput {
  externalId?: string;
  firstName?: string;
  lastName?: string;
  email: string; // required + unique within the org
  phone?: string;
  position?: string;
  isMain?: boolean;
}

export interface UpflowCustomerInput {
  externalId?: string;
  name: string;
  vatNumber?: string;
  address?: UpflowAddress;
  contacts?: UpflowContactInput[];
}

export interface UpflowInvoiceInput {
  customId: string; // human-readable invoice number
  externalId?: string; // source-system id; idempotency key
  issuedAt: string; // ISO 8601
  dueDate: string; // ISO 8601
  currency: string; // ISO 4217
  grossAmount: number; // cents, incl. tax
  netAmount: number; // cents, excl. tax
  name?: string;
  customer: { id: string } | { externalId: string };
}

export interface UpflowEntityResponse {
  id: string;
  externalId?: string;
  [key: string]: unknown;
}
