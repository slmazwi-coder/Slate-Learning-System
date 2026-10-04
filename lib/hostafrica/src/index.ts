// Typed client for the HostAfrica public API (https://api.hostafrica.com/docs/,
// OpenAPI "HostAfricaApi" v1.1.0). Every endpoint is POST + JSON and is
// authenticated with `Authorization: Bearer <token>`. The token has the same
// privileges as the owning client account, so it is server/CLI-only: read it
// from HOSTAFRICA_API_TOKEN and never expose it to the browser.

export const HOSTAFRICA_API_BASE = "https://api.hostafrica.com";
export const HOSTAFRICA_TOKEN_ENV = "HOSTAFRICA_API_TOKEN";

export type HostAfricaEnvelope<T> = {
  status: "success" | "error";
  data: T;
  message?: string;
};

export class HostAfricaError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
    readonly httpStatus: number | null,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "HostAfricaError";
  }
}

// ---- DNS ----
export type DnsZone = {
  zone_id: string;
  domain_id: string;
  domain_name: string;
  hosting_id?: number;
  type: number;
  type_key: string;
  package_name: string;
  has_hosting?: { hosting_id: number; module: string } | null;
  has_dns_manager_zone: boolean;
};

export type DnsRecord = {
  id?: string;
  name?: string;
  type?: string;
  content?: string;
  ttl?: number;
  priority?: number;
  weight?: number;
  port?: number;
};

export type DnsZoneDetails = {
  message: string;
  domain_id?: string;
  zone_id?: string;
  zone_exists?: boolean;
  management_available?: boolean;
  domain_nameservers?: string[];
  ns_changing?: string;
  package_settings?: unknown;
  records?: DnsRecord[];
};

export type DnsRecordMutation = { message: string; records?: DnsRecord[] };
export type DnsRecordRequest = {
  zone_id: string;
  domain_name?: string;
  record: DnsRecord;
};

// ---- Domains ----
export type DomainSummary = {
  domain_id: string;
  domain: string;
  type: string;
  status: string;
  period: number;
  expirydate?: string;
  nextduedate?: string;
  recurringamount?: string;
  donotrenew: number;
  id_protection: number;
  has_dns_manager_zone?: boolean;
  has_hosting?: { hosting_id: number; module: string } | null;
  [key: string]: unknown;
};

export type DomainDetails = DomainSummary & {
  sld?: string;
  tld?: string;
  registrationdate?: string;
  dnsmanagement?: boolean;
  emailforwarding?: boolean;
  lock_status?: string;
  nameservers?: Record<string, string>;
};

export type DomainSetting =
  "donotrenew" | "idprotection" | "dnsmanagement" | "emailforwarding";
export type Nameservers = {
  ns1: string;
  ns2: string;
  ns3?: string;
  ns4?: string;
  ns5?: string;
};
export type ContactRole = "Registrant" | "Admin" | "Tech" | "Billing";

// ---- Billing ----
export type InvoiceSummary = {
  invoice_id: string;
  invoice_number: string;
  date: string;
  due_date: string;
  status: string;
  subtotal: string;
  tax: string;
  total: string;
  grand_total: string;
};

export type InvoiceDetails = InvoiceSummary & {
  date_paid?: string;
  payment_method?: string;
  total_due?: string;
  items?: unknown[];
  transactions?: unknown[];
  [key: string]: unknown;
};

export type HostAfricaClientOptions = {
  token?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function readHostAfricaToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const token = env[HOSTAFRICA_TOKEN_ENV]?.trim();
  if (!token)
    throw new HostAfricaError(
      `${HOSTAFRICA_TOKEN_ENV} must be configured`,
      "-",
      null,
    );
  return token;
}

export function isHostAfricaConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env[HOSTAFRICA_TOKEN_ENV]?.trim());
}

export class HostAfricaClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HostAfricaClientOptions = {}) {
    this.token = options.token ?? readHostAfricaToken();
    this.baseUrl = (options.baseUrl ?? HOSTAFRICA_API_BASE).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  // All endpoints are POST with a JSON body; list endpoints accept `{}`.
  async call<T>(
    endpoint: string,
    body: Record<string, unknown> = {},
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint.replace(/^\/+/, "")}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new HostAfricaError(
        `HostAfrica request failed (${endpoint}): ${reason}`,
        endpoint,
        null,
      );
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    const envelope = isEnvelope(parsed) ? parsed : null;
    if (!response.ok || envelope?.status === "error") {
      const message =
        envelope?.message ??
        (typeof parsed === "string" ? parsed : response.statusText);
      throw new HostAfricaError(
        `HostAfrica ${endpoint} → ${response.status}: ${message || "request failed"}`,
        endpoint,
        response.status,
        parsed,
      );
    }
    if (!envelope) {
      throw new HostAfricaError(
        `HostAfrica ${endpoint} returned an unexpected body`,
        endpoint,
        response.status,
        parsed,
      );
    }
    return envelope.data as T;
  }

  // ---- DNS (read) ----
  listDnsZones() {
    return this.call<{ message: string; zones: DnsZone[]; total: number }>(
      "dns/list-zones",
    );
  }
  getDnsZone(domainId: string) {
    return this.call<DnsZoneDetails>("dns/get-zone", { domain_id: domainId });
  }
  listRdnsRecords() {
    return this.call<{
      records: unknown[];
      ptr_count: number;
      ptr_limit: number;
    }>("dns/list-rdns-records");
  }

  // ---- DNS (write) ----
  addDnsRecord(input: DnsRecordRequest) {
    return this.call<DnsRecordMutation>("dns/add-record", input);
  }
  editDnsRecord(input: DnsRecordRequest) {
    return this.call<DnsRecordMutation>("dns/edit-record", input);
  }
  deleteDnsRecord(input: DnsRecordRequest) {
    return this.call<DnsRecordMutation>("dns/delete-record", input);
  }

  // ---- Domains ----
  listDomains() {
    return this.call<{
      message: string;
      domains: DomainSummary[];
      total_count: number;
    }>("domain/list-domains");
  }
  getDomain(domainId: string) {
    return this.call<{ message: string; domain: DomainDetails }>(
      "domain/get-domain",
      { domain_id: domainId },
    );
  }
  getDomainContacts(domainId: string) {
    return this.call<{
      message: string;
      domain: string;
      contacts: Partial<Record<ContactRole, unknown>>;
    }>("domain/get-domain-contacts", { domain_id: domainId });
  }
  listDnssecRecords(domainId: string) {
    return this.call<{ message: string; records: unknown[] }>(
      "domain/list-dnssec-records",
      { domain_id: domainId },
    );
  }
  checkDomainAvailability(domain: string, currency?: string) {
    return this.call<{
      domains: unknown[];
      suggestions?: string[];
      currency_code: string;
    }>(
      "domain/check-availability",
      currency ? { domain, currency } : { domain },
    );
  }
  updateNameservers(domainId: string, nameservers: Nameservers) {
    return this.call<{
      message: string;
      domain?: string;
      nameservers?: Nameservers;
    }>("domain/update-nameservers", {
      domain_id: domainId,
      ...nameservers,
    });
  }
  updateDomainSetting(
    domainId: string,
    setting: DomainSetting,
    value: boolean,
  ) {
    return this.call<{
      message: string;
      setting: DomainSetting;
      value: boolean;
      requires_payment: boolean;
    }>("domain/update-domain-settings", {
      domain_id: domainId,
      setting,
      value,
    });
  }

  // ---- Billing ----
  listInvoices() {
    return this.call<{ invoices: InvoiceSummary[]; total_count: number }>(
      "billing/list-invoices",
    );
  }
  getInvoice(invoiceId: string) {
    return this.call<{ invoice: InvoiceDetails }>(
      "billing/get-invoice-details",
      { invoice_id: invoiceId },
    );
  }

  // Convenience: zones are keyed by domain_id/zone_id, but humans think in names.
  async findZoneByName(domainName: string): Promise<DnsZone | null> {
    const { zones } = await this.listDnsZones();
    const wanted = domainName.trim().toLowerCase();
    return zones.find((z) => z.domain_name.toLowerCase() === wanted) ?? null;
  }
}

function isEnvelope(value: unknown): value is HostAfricaEnvelope<unknown> {
  return typeof value === "object" && value !== null && "data" in value;
}
