// On-demand HostAfrica account management from the terminal.
//
//   HOSTAFRICA_API_TOKEN=... pnpm --filter @workspace/scripts run hostafrica <command> [args]
//
// Read-only:
//   domains                         list registered domains
//   domain <domain|domain_id>       domain details
//   contacts <domain|domain_id>     WHOIS contacts
//   zones                           list DNS zones
//   zone <domain|domain_id>         DNS records for a zone
//   invoices                        list invoices
//   invoice <invoice_id>            invoice details
//   check <domain>                  registration availability
// Mutating (prints the resulting record set):
//   dns add    <domain> <type> <name> <content> [ttl] [priority]
//   dns edit   <domain> <record_id> <type> <name> <content> [ttl] [priority]
//   dns delete <domain> <record_id>
//   nameservers <domain> <ns1> <ns2> [ns3] [ns4] [ns5]
//   setting <domain> <donotrenew|idprotection|dnsmanagement|emailforwarding> <true|false>
import {
  HostAfricaClient,
  HostAfricaError,
  type DnsRecord,
  type DomainSetting,
} from "@workspace/hostafrica";

const USAGE = `usage: hostafrica <command> [args]
  domains | domain <d> | contacts <d> | zones | zone <d> | invoices | invoice <id> | check <domain>
  dns add <d> <type> <name> <content> [ttl] [priority]
  dns edit <d> <record_id> <type> <name> <content> [ttl] [priority]
  dns delete <d> <record_id>
  nameservers <d> <ns1> <ns2> [ns3] [ns4] [ns5]
  setting <d> <donotrenew|idprotection|dnsmanagement|emailforwarding> <true|false>
(<d> is a domain name or HostAfrica domain_id; --json prints raw responses)`;

const DOMAIN_SETTINGS: DomainSetting[] = [
  "donotrenew",
  "idprotection",
  "dnsmanagement",
  "emailforwarding",
];

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function table(rows: Record<string, unknown>[], columns: string[]) {
  if (rows.length === 0) return console.log("(none)");
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(columns));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const row of rows)
    console.log(line(columns.map((c) => String(row[c] ?? ""))));
}

function need(args: string[], count: number, what: string): string[] {
  if (args.length < count)
    throw new Error(`missing arguments: ${what}\n${USAGE}`);
  return args;
}

async function resolveDomainId(
  client: HostAfricaClient,
  ref: string,
): Promise<string> {
  if (/^\d+$/.test(ref)) return ref;
  const { domains } = await client.listDomains();
  const match = domains.find(
    (d) => d.domain.toLowerCase() === ref.toLowerCase(),
  );
  if (!match)
    throw new Error(`domain "${ref}" is not in this HostAfrica account`);
  return match.domain_id;
}

async function resolveZone(client: HostAfricaClient, ref: string) {
  const zone = /^\d+$/.test(ref)
    ? ((await client.listDnsZones()).zones.find(
        (z) => z.domain_id === ref || z.zone_id === ref,
      ) ?? null)
    : await client.findZoneByName(ref);
  if (!zone)
    throw new Error(`no DNS zone for "${ref}" in this HostAfrica account`);
  return zone;
}

function recordFromArgs(args: string[], withId: boolean): DnsRecord {
  const [id, type, name, content, ttl, priority] = withId
    ? args
    : [undefined, ...args];
  const record: DnsRecord = { type: (type ?? "").toUpperCase(), name, content };
  if (id) record.id = id;
  if (ttl) record.ttl = Number(ttl);
  if (priority) record.priority = Number(priority);
  return record;
}

async function main(argv: string[]) {
  const json = argv.includes("--json");
  const [command, ...args] = argv.filter((a) => a !== "--json");
  if (!command || command === "help" || command === "--help")
    return console.log(USAGE);

  const client = new HostAfricaClient();

  switch (command) {
    case "domains": {
      const data = await client.listDomains();
      if (json) return print(data);
      return table(data.domains, [
        "domain_id",
        "domain",
        "status",
        "expirydate",
        "recurringamount",
        "donotrenew",
      ]);
    }
    case "domain": {
      const [ref] = need(args, 1, "<domain|domain_id>");
      return print(
        (await client.getDomain(await resolveDomainId(client, ref))).domain,
      );
    }
    case "contacts": {
      const [ref] = need(args, 1, "<domain|domain_id>");
      return print(
        (await client.getDomainContacts(await resolveDomainId(client, ref)))
          .contacts,
      );
    }
    case "zones": {
      const data = await client.listDnsZones();
      if (json) return print(data);
      return table(data.zones, [
        "domain_id",
        "zone_id",
        "domain_name",
        "package_name",
        "has_dns_manager_zone",
      ]);
    }
    case "zone": {
      const [ref] = need(args, 1, "<domain|domain_id>");
      const zone = await resolveZone(client, ref);
      const data = await client.getDnsZone(zone.domain_id);
      if (json) return print(data);
      console.log(
        `${zone.domain_name}  zone_id=${zone.zone_id}  nameservers=${(data.domain_nameservers ?? []).join(", ")}`,
      );
      return table(data.records ?? [], [
        "id",
        "type",
        "name",
        "content",
        "ttl",
        "priority",
      ]);
    }
    case "invoices": {
      const data = await client.listInvoices();
      if (json) return print(data);
      return table(data.invoices, [
        "invoice_id",
        "date",
        "due_date",
        "status",
        "total",
      ]);
    }
    case "invoice": {
      const [id] = need(args, 1, "<invoice_id>");
      return print((await client.getInvoice(id)).invoice);
    }
    case "check": {
      const [domain] = need(args, 1, "<domain>");
      return print(await client.checkDomainAvailability(domain));
    }
    case "dns": {
      const [action, ref, ...rest] = need(
        args,
        2,
        "dns <add|edit|delete> <domain> ...",
      );
      const zone = await resolveZone(client, ref);
      const base = { zone_id: zone.zone_id, domain_name: zone.domain_name };
      let result;
      if (action === "add") {
        result = await client.addDnsRecord({
          ...base,
          record: recordFromArgs(
            need(rest, 3, "<type> <name> <content>"),
            false,
          ),
        });
      } else if (action === "edit") {
        result = await client.editDnsRecord({
          ...base,
          record: recordFromArgs(
            need(rest, 4, "<record_id> <type> <name> <content>"),
            true,
          ),
        });
      } else if (action === "delete") {
        const [recordId] = need(rest, 1, "<record_id>");
        const existing = (
          await client.getDnsZone(zone.domain_id)
        ).records?.find((r) => r.id === recordId);
        if (!existing)
          throw new Error(
            `record ${recordId} not found in zone ${zone.domain_name}`,
          );
        result = await client.deleteDnsRecord({ ...base, record: existing });
      } else {
        throw new Error(`unknown dns action "${action}"\n${USAGE}`);
      }
      console.log(result.message);
      if (json) return print(result);
      return table(result.records ?? [], [
        "id",
        "type",
        "name",
        "content",
        "ttl",
        "priority",
      ]);
    }
    case "nameservers": {
      const [ref, ns1, ns2, ns3, ns4, ns5] = need(
        args,
        3,
        "<domain> <ns1> <ns2>",
      );
      const domainId = await resolveDomainId(client, ref);
      return print(
        await client.updateNameservers(domainId, { ns1, ns2, ns3, ns4, ns5 }),
      );
    }
    case "setting": {
      const [ref, setting, value] = need(
        args,
        3,
        "<domain> <setting> <true|false>",
      );
      if (!DOMAIN_SETTINGS.includes(setting as DomainSetting))
        throw new Error(`setting must be one of ${DOMAIN_SETTINGS.join(", ")}`);
      if (value !== "true" && value !== "false")
        throw new Error("value must be true or false");
      const domainId = await resolveDomainId(client, ref);
      return print(
        await client.updateDomainSetting(
          domainId,
          setting as DomainSetting,
          value === "true",
        ),
      );
    }
    default:
      throw new Error(`unknown command "${command}"\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof HostAfricaError) {
    console.error(err.message);
    if (err.body && typeof err.body === "object")
      console.error(JSON.stringify(err.body));
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
