import { Router, type IRouter } from "express";
import { z } from "zod";
import { recordAudit } from "../lib/audit";
import {
  hostAfricaClient,
  requireHostAfricaAdmin,
  sendHostAfricaError,
} from "../lib/hostafrica";

// Admin surface over the HostAfrica account (DNS, domains, billing). Every
// route is gated by requireHostAfricaAdmin; every mutation is audited.
const router: IRouter = Router();

const DomainId = z.string().regex(/^\d+$/, "domain_id must be numeric");

const DnsRecordBody = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  type: z
    .string()
    .min(1)
    .transform((t) => t.toUpperCase()),
  content: z.string().min(1),
  ttl: z.number().int().positive().optional(),
  priority: z.number().int().min(0).optional(),
  weight: z.number().int().min(0).optional(),
  port: z.number().int().min(0).optional(),
});

const DnsMutationBody = z.object({
  zone_id: z.string().min(1),
  domain_name: z.string().optional(),
  record: DnsRecordBody,
});

const NameserversBody = z.object({
  ns1: z.string().min(1),
  ns2: z.string().min(1),
  ns3: z.string().optional(),
  ns4: z.string().optional(),
  ns5: z.string().optional(),
});

const DomainSettingBody = z.object({
  setting: z.enum([
    "donotrenew",
    "idprotection",
    "dnsmanagement",
    "emailforwarding",
  ]),
  value: z.boolean(),
});

function summarizeRecord(r: {
  id?: string;
  type?: string;
  name?: string;
  content?: string;
}) {
  return `${r.type ?? "?"} ${r.name ?? "?"} → ${r.content ?? "?"}${r.id ? ` (#${r.id})` : ""}`;
}

// ---- Read-only ----
router.get("/admin/hostafrica/domains", async (req, res) => {
  if (!(await requireHostAfricaAdmin(req, res))) return;
  try {
    return res.json(await hostAfricaClient().listDomains());
  } catch (err) {
    return sendHostAfricaError(res, err, "list_domains");
  }
});

router.get("/admin/hostafrica/domains/:domainId", async (req, res) => {
  if (!(await requireHostAfricaAdmin(req, res))) return;
  const parsed = DomainId.safeParse(req.params.domainId);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message });
  try {
    return res.json(await hostAfricaClient().getDomain(parsed.data));
  } catch (err) {
    return sendHostAfricaError(res, err, "get_domain");
  }
});

router.get("/admin/hostafrica/domains/:domainId/contacts", async (req, res) => {
  if (!(await requireHostAfricaAdmin(req, res))) return;
  const parsed = DomainId.safeParse(req.params.domainId);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message });
  try {
    return res.json(await hostAfricaClient().getDomainContacts(parsed.data));
  } catch (err) {
    return sendHostAfricaError(res, err, "get_domain_contacts");
  }
});

router.get("/admin/hostafrica/dns/zones", async (req, res) => {
  if (!(await requireHostAfricaAdmin(req, res))) return;
  try {
    return res.json(await hostAfricaClient().listDnsZones());
  } catch (err) {
    return sendHostAfricaError(res, err, "list_zones");
  }
});

router.get("/admin/hostafrica/dns/zones/:domainId", async (req, res) => {
  if (!(await requireHostAfricaAdmin(req, res))) return;
  const parsed = DomainId.safeParse(req.params.domainId);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0]?.message });
  try {
    return res.json(await hostAfricaClient().getDnsZone(parsed.data));
  } catch (err) {
    return sendHostAfricaError(res, err, "get_zone");
  }
});

router.get("/admin/hostafrica/billing/invoices", async (req, res) => {
  if (!(await requireHostAfricaAdmin(req, res))) return;
  try {
    return res.json(await hostAfricaClient().listInvoices());
  } catch (err) {
    return sendHostAfricaError(res, err, "list_invoices");
  }
});

router.get(
  "/admin/hostafrica/billing/invoices/:invoiceId",
  async (req, res) => {
    if (!(await requireHostAfricaAdmin(req, res))) return;
    const parsed = DomainId.safeParse(req.params.invoiceId);
    if (!parsed.success)
      return res.status(400).json({ error: "invoice_id must be numeric" });
    try {
      return res.json(await hostAfricaClient().getInvoice(parsed.data));
    } catch (err) {
      return sendHostAfricaError(res, err, "get_invoice");
    }
  },
);

// ---- Mutations (audited) ----
router.post("/admin/hostafrica/dns/records", async (req, res) => {
  const admin = await requireHostAfricaAdmin(req, res);
  if (!admin) return;
  const parsed = DnsMutationBody.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid record" });
  try {
    const result = await hostAfricaClient().addDnsRecord(parsed.data);
    await recordAudit({
      actorUserId: admin.user.id,
      actorRole: admin.activeRole,
      action: "hostafrica_dns_add",
      detail: `${parsed.data.domain_name ?? `zone ${parsed.data.zone_id}`}: ${summarizeRecord(parsed.data.record)}`,
    });
    return res.json(result);
  } catch (err) {
    return sendHostAfricaError(res, err, "dns_add");
  }
});

router.put("/admin/hostafrica/dns/records", async (req, res) => {
  const admin = await requireHostAfricaAdmin(req, res);
  if (!admin) return;
  const parsed = DnsMutationBody.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid record" });
  if (!parsed.data.record.id)
    return res
      .status(400)
      .json({ error: "record.id is required to edit a record" });
  try {
    const result = await hostAfricaClient().editDnsRecord(parsed.data);
    await recordAudit({
      actorUserId: admin.user.id,
      actorRole: admin.activeRole,
      action: "hostafrica_dns_edit",
      detail: `${parsed.data.domain_name ?? `zone ${parsed.data.zone_id}`}: ${summarizeRecord(parsed.data.record)}`,
    });
    return res.json(result);
  } catch (err) {
    return sendHostAfricaError(res, err, "dns_edit");
  }
});

// HostAfrica requires the full record (not just the id) to delete.
router.delete("/admin/hostafrica/dns/records", async (req, res) => {
  const admin = await requireHostAfricaAdmin(req, res);
  if (!admin) return;
  const parsed = DnsMutationBody.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid record" });
  if (!parsed.data.record.id)
    return res
      .status(400)
      .json({ error: "record.id is required to delete a record" });
  try {
    const result = await hostAfricaClient().deleteDnsRecord(parsed.data);
    await recordAudit({
      actorUserId: admin.user.id,
      actorRole: admin.activeRole,
      action: "hostafrica_dns_delete",
      detail: `${parsed.data.domain_name ?? `zone ${parsed.data.zone_id}`}: ${summarizeRecord(parsed.data.record)}`,
    });
    return res.json(result);
  } catch (err) {
    return sendHostAfricaError(res, err, "dns_delete");
  }
});

router.put(
  "/admin/hostafrica/domains/:domainId/nameservers",
  async (req, res) => {
    const admin = await requireHostAfricaAdmin(req, res);
    if (!admin) return;
    const domainId = DomainId.safeParse(req.params.domainId);
    if (!domainId.success)
      return res.status(400).json({ error: domainId.error.issues[0]?.message });
    const parsed = NameserversBody.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          error: parsed.error.issues[0]?.message ?? "Invalid nameservers",
        });
    try {
      const result = await hostAfricaClient().updateNameservers(
        domainId.data,
        parsed.data,
      );
      await recordAudit({
        actorUserId: admin.user.id,
        actorRole: admin.activeRole,
        action: "hostafrica_nameservers_update",
        detail: `domain ${domainId.data}: ${Object.values(parsed.data).filter(Boolean).join(", ")}`,
      });
      return res.json(result);
    } catch (err) {
      return sendHostAfricaError(res, err, "nameservers_update");
    }
  },
);

router.put("/admin/hostafrica/domains/:domainId/settings", async (req, res) => {
  const admin = await requireHostAfricaAdmin(req, res);
  if (!admin) return;
  const domainId = DomainId.safeParse(req.params.domainId);
  if (!domainId.success)
    return res.status(400).json({ error: domainId.error.issues[0]?.message });
  const parsed = DomainSettingBody.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid setting" });
  try {
    const result = await hostAfricaClient().updateDomainSetting(
      domainId.data,
      parsed.data.setting,
      parsed.data.value,
    );
    await recordAudit({
      actorUserId: admin.user.id,
      actorRole: admin.activeRole,
      action: "hostafrica_domain_setting_update",
      detail: `domain ${domainId.data}: ${parsed.data.setting}=${parsed.data.value}`,
    });
    return res.json(result);
  } catch (err) {
    return sendHostAfricaError(res, err, "domain_setting_update");
  }
});

export default router;
