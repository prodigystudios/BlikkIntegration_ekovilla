// Fortnox OAuth token response from /oauth-v1/token
export type FortnoxTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

// Row in fortnox_integrations table
export type FortnoxIntegration = {
  id: string;
  provider: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string | null;
  connected_by: string | null;
  connected_at: string;
  updated_at: string;
};

// Fortnox integration connection status (public-safe, no tokens)
export type FortnoxConnectionStatus = {
  connected: boolean;
  connected_by: string | null;
  connected_at: string | null;
  scope: string | null;
  is_test_mode: boolean;
};

// Article from Fortnox /3/articles
export type FortnoxArticle = {
  ArticleNumber: string;
  Description: string;
  SalesPrice: number | null;
  PurchasePrice: number | null;
  Unit: string | null;
  Type: string;
  Active: boolean;
};

export type FortnoxArticleListResponse = {
  Articles: FortnoxArticle[];
  MetaInformation: {
    '@TotalResources': number;
    '@TotalPages': number;
    '@CurrentPage': number;
  };
};

// Cached article row from fortnox_articles_cache
export type CachedFortnoxArticle = {
  article_number: string;
  description: string | null;
  sales_price: number | null;
  purchase_price: number | null;
  unit: string | null;
  article_type: string | null;
  active: boolean;
  last_fetched_at: string;
};

// Valid Fortnox HouseWorkType values for ROT work (the subset relevant to our
// trade). RUT types are intentionally excluded – we only offer ROT. Shared by the
// quote form, the Zod schema and the offer/order payload builders so they agree.
export const ROT_HOUSE_WORK_TYPES = [
  'CONSTRUCTION', 'ELECTRICITY', 'GLASSMETALWORK', 'GROUNDDRAINAGEWORK',
  'HVAC', 'MASONRY', 'PAINTINGWALLPAPERING', 'OTHERCOSTS',
] as const;
export type RotHouseWorkType = typeof ROT_HOUSE_WORK_TYPES[number];
export const DEFAULT_ROT_HOUSE_WORK_TYPE: RotHouseWorkType = 'CONSTRUCTION';

// Customer from Fortnox /3/customers
export type FortnoxCustomer = {
  CustomerNumber: string;
  Name: string;
  OrganisationNumber: string | null;
  Address1: string | null;
  Address2: string | null;
  ZipCode: string | null;
  City: string | null;
  Email: string | null;
  Phone1: string | null;
  Phone2: string | null;
  Mobile: string | null;
  Type: 'COMPANY' | 'PRIVATE' | string;
  Active: boolean;
  // Visiting address (besöksadress) – a separate register from the main/invoice address.
  VisitingAddress: string | null;
  VisitingZipCode: string | null;
  VisitingCity: string | null;
  // Delivery address
  DeliveryAddress1: string | null;
  DeliveryZipCode: string | null;
  DeliveryCity: string | null;
  // Billing fields
  EmailInvoice: string | null;
  TermsOfPayment: string | null;
  PriceList: string | null;
  InvoiceDiscount: number | null;
  VATNumber: string | null;
  VATType: 'SEVAT' | 'SEREVERSEDVAT' | string | null;
};

export type FortnoxCustomerListResponse = {
  Customers: FortnoxCustomer[];
  MetaInformation: {
    '@TotalResources': number;
    '@TotalPages': number;
    '@CurrentPage': number;
  };
};

// Register endpoints used to populate customer-form dropdowns with valid codes.
export type FortnoxRegisterEntry = { Code: string; Description: string };
export type FortnoxTermsOfPaymentListResponse = { TermsOfPayments: FortnoxRegisterEntry[] };
export type FortnoxPriceListResponse = { PriceLists: FortnoxRegisterEntry[] };
