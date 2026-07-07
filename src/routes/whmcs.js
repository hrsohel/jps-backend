import express from "express";
import { requireAuth, STAFF_ROLES } from "../middleware/auth.js";

const router = express.Router();

async function whmcsCall(action, params = {}) {
  const body = new URLSearchParams({
    identifier: process.env.WHMCS_IDENTIFIER,
    secret: process.env.WHMCS_SECRET,
    action,
    responsetype: "json",
    ...params,
  });

  const response = await fetch(process.env.WHMCS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) throw new Error(`WHMCS HTTP ${response.status}`);
  return response.json();
}

async function getClientId(email) {
  const data = await whmcsCall("GetClients", { search: email, limitnum: 1 });
  if (data.result === "success" && data.clients?.client?.length > 0) {
    return data.clients.client[0].id;
  }
  return null;
}

// GET /api/whmcs/services — hosting products + domains for the logged-in client
router.get("/services", requireAuth, async (req, res) => {
  try {
    const clientId = await getClientId(req.user.email);
    if (!clientId) {
      return res.json({ hosting: [], domains: [], clientId: null });
    }

    const [productsData, domainsData] = await Promise.all([
      whmcsCall("GetClientsProducts", { clientid: clientId }),
      whmcsCall("GetClientsDomains", { clientid: clientId }),
    ]);

    const hosting = productsData.result === "success"
      ? [].concat(productsData.products?.product || [])
      : [];

    const domains = domainsData.result === "success"
      ? [].concat(domainsData.domains?.domain || [])
      : [];

    res.json({ hosting, domains, clientId });
  } catch (error) {
    console.error("WHMCS services error:", error);
    res.status(500).json({ error: "Unable to fetch hosting services" });
  }
});

// GET /api/whmcs/invoices — WHMCS billing invoices for the logged-in client
router.get("/invoices", requireAuth, async (req, res) => {
  try {
    const clientId = await getClientId(req.user.email);
    if (!clientId) {
      return res.json({ invoices: [] });
    }

    const data = await whmcsCall("GetInvoices", { userid: clientId, limitnum: 25 });
    const invoices = data.result === "success"
      ? [].concat(data.invoices?.invoice || [])
      : [];

    res.json({ invoices });
  } catch (error) {
    console.error("WHMCS invoices error:", error);
    res.status(500).json({ error: "Unable to fetch WHMCS invoices" });
  }
});

// POST /api/whmcs/sync — admin: sync a JPS Core user with their WHMCS account
router.post("/sync", requireAuth, async (req, res) => {
  try {
    if (!STAFF_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const data = await whmcsCall("GetClients", { search: email, limitnum: 1 });
    if (data.result !== "success" || !data.clients?.client?.length) {
      return res.json({ found: false, message: "No WHMCS account found for this email" });
    }

    const client = data.clients.client[0];
    res.json({
      found: true,
      client: {
        id: client.id,
        name: `${client.firstname} ${client.lastname}`.trim(),
        email: client.email,
        company: client.companyname,
        status: client.status,
      },
    });
  } catch (error) {
    console.error("WHMCS sync error:", error);
    res.status(500).json({ error: "Unable to sync with WHMCS" });
  }
});

export default router;
