// Subset of FreshBooks API shapes we consume. Not exhaustive — only fields used.

export interface FbMoney {
  amount: string; // decimal string, e.g. "500.00"
  code: string; // currency code, e.g. "EUR"
}

export interface FbTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  refresh_token: string;
  scope: string;
  created_at: number; // unix seconds
}

export interface FbBusinessMembership {
  id: number;
  role: string;
  business: {
    id: number;
    business_uuid: string;
    name: string;
    account_id: string;
    active: boolean;
  };
}

export interface FbMeResponse {
  response: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    business_memberships: FbBusinessMembership[];
  };
}

export interface FbClient {
  id: number;
  userid: number;
  fname: string;
  lname: string;
  email: string;
  organization: string;
  currency_code: string;
  vat_number?: string | null;
  p_street?: string | null;
  p_street2?: string | null;
  p_city?: string | null;
  p_province?: string | null;
  p_code?: string | null; // zip / postal code
  p_country?: string | null;
  vis_state: number; // 0 active, 1 archived, 2 deleted
  updated: string;
}

export interface FbInvoiceLine {
  lineid?: number;
  type?: number;
  name?: string;
  description?: string;
  qty?: string;
  unit_cost?: FbMoney;
  amount?: FbMoney;
  taxName1?: string;
  taxAmount1?: string; // percent, e.g. "21"
  taxName2?: string;
  taxAmount2?: string;
}

export interface FbInvoice {
  id: number;
  invoiceid: number;
  invoice_number: string;
  status: number;
  v3_status: string;
  customerid: number;
  organization?: string;
  currency_code: string;
  amount: FbMoney; // total incl. tax
  paid?: FbMoney;
  outstanding?: FbMoney;
  create_date: string; // YYYY-MM-DD
  due_date?: string | null; // YYYY-MM-DD
  date_paid?: string | null;
  updated: string;
  vis_state: number;
  lines?: FbInvoiceLine[];
}

export interface FbListPagination {
  page: number;
  pages: number;
  per_page: number;
  total: number;
}

export interface FbClientsListResponse {
  response: {
    result: FbListPagination & { clients: FbClient[] };
  };
}

export interface FbInvoicesListResponse {
  response: {
    result: FbListPagination & { invoices: FbInvoice[] };
  };
}

export interface FbInvoiceSingleResponse {
  response: {
    result: { invoice: FbInvoice };
  };
}

export interface FbClientSingleResponse {
  response: {
    result: { client: FbClient };
  };
}
