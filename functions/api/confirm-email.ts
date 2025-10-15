// functions/api/confirm-email.ts
// Cloudflare Workers style handler

const randomToken = (len = 32) => {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
};

type LeadRecord = {
  email?: string;
  name?: string;
  ip?: string | null;
  user_agent?: string | null;
};

const isInsertOnLeads = (payload: any) => {
  const eventType = payload?.type || payload?.event;
  const table = payload?.table || payload?.table_name;
  return table === "leads" && eventType === "INSERT";
};

const normalizeEmail = (e: string) => e.trim().toLowerCase();

// Very light sanity check; rely on double opt-in as the true validator
const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const buildEmail = ({
  name,
  email,
  verifyUrl,
  origin,
}: {
  name?: string;
  email: string;
  verifyUrl: string;
  origin: string;
}) => {
  const firstName = (name || "").trim().split(" ")[0] || "";
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const subject = "Confirm your early access to HabitBlock ✅";

  const preheader =
    "Confirm to secure your spot, get early features, and help shape the app.";

  const text =
    `${greeting}\n\n` +
    `Thanks for signing up for early access to HabitBlock.\n\n` +
    `Confirm your email to secure your spot and get early feature access:\n` +
    `${verifyUrl}\n\n` +
    `Once you confirm, you will:\n` +
    `• Be among the first to try HabitBlock\n` +
    `• Get priority updates and early features\n` +
    `• Help shape the app with your feedback\n\n` +
    `If the button doesn't work, copy and paste this link:\n${verifyUrl}\n\n` +
    `— The HabitBlock Team\n${origin.replace(/^https?:\/\//, "")}\n`;

  // Simple, bulletproof-ish template: inline styles; hidden preheader; big CTA; fallback link
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
    <title>${subject}</title>
    <style>
      .preheader{display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;}
      a.button{background:#9d0208;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;display:inline-block;font-weight:600}
      @media (prefers-color-scheme: dark){
        body{background:#0b0b0b!important;color:#f3f3f3!important}
        .card{background:#121212!important;border-color:#222!important}
        a.button{background:#b1060e!important}
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f6f7f9;">
    <span class="preheader">${preheader}</span>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f7f9;padding:24px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #eaeaea;border-radius:12px;" class="card">
            <tr>
              <td style="padding:28px 24px 8px 24px; font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; font-size:16px; line-height:1.5; color:#222;">
                <div style="font-size:18px;font-weight:700;margin-bottom:8px;">HabitBlock</div>
                <p style="margin:0 0 12px 0;">${greeting}</p>
                <p style="margin:0 0 16px 0;">Thanks for signing up for <strong>early access to HabitBlock</strong> — we’re excited to have you on board!</p>
                <p style="margin:0 0 16px 0;">To secure your spot and get notified when we launch, please confirm your email:</p>
                <p style="margin:0 0 20px 0;">
                  <a href="${verifyUrl}" class="button">Confirm my email</a>
                </p>
                <p style="margin:0 0 10px 0;"><strong>After you confirm, you’ll:</strong></p>
                <ul style="margin:0 0 18px 20px; padding:0;">
                  <li>Be among the first to try HabitBlock</li>
                  <li>Get priority updates and early features</li>
                  <li>Help shape the app with your feedback</li>
                </ul>
                <p style="margin:0 0 18px 0;">If the button doesn’t work, paste this link into your browser:<br/>
                  <a href="${verifyUrl}" style="word-break:break-all;">${verifyUrl}</a>
                </p>
                <p style="margin:12px 0 0 0;">— The HabitBlock Team<br/><span style="color:#666;">${origin.replace(
                  /^https?:\/\//,
                  ""
                )}</span></p>
              </td>
            </tr>
          </table>
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#777;margin-top:12px;">
            You received this because you requested early access. This transactional email doesn’t include unsubscribe links.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html, preheader };
};

export const onRequest = async ({
  request,
  env,
}: {
  request: Request;
  env: Record<string, string>;
}) => {
  try {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Verify shared-secret header from Supabase Webhooks
    const tokenHeader =
      request.headers.get("x-webhook-token") ||
      request.headers.get("X-Webhook-Token") ||
      "";
    if (!env.WEBHOOK_TOKEN || tokenHeader !== env.WEBHOOK_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Parse and validate payload
    const payload = await request.json().catch(() => ({} as any));
    if (!isInsertOnLeads(payload)) {
      return new Response("Ignored", { status: 200 });
    }

    const lead: LeadRecord = payload?.record || {};
    const emailRaw = String(lead.email || "");
    const email = normalizeEmail(emailRaw);
    if (!email || !looksLikeEmail(email)) {
      return new Response("Missing or invalid email", { status: 400 });
    }

    if (!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE)) {
      return new Response("Server misconfigured", { status: 500 });
    }

    // Reuse an unexpired token if it exists
    const check = await fetch(
      `${env.SUPABASE_URL}/rest/v1/email_verifications` +
        `?email=eq.${encodeURIComponent(email)}` +
        `&used_at=is.null&select=token,expires_at&order=created_at.desc&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        },
      }
    );

    if (!check.ok) {
      const t = await check.text();
      console.error("Lookup failed", t);
      return new Response("Lookup failed", { status: 502 });
    }

    const existing = (await check.json()) as Array<{
      token: string;
      expires_at: string;
    }>;

    const stillValid =
      existing?.[0] && new Date(existing[0].expires_at).getTime() > Date.now();

    const token = stillValid ? existing![0].token : randomToken(32);

    if (!stillValid) {
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const insert = await fetch(`${env.SUPABASE_URL}/rest/v1/email_verifications`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          email,
          token,
          expires_at: expiresAt,
          ip: lead.ip || null,
          user_agent: lead.user_agent || null,
        }),
      });
      if (!insert.ok) {
        const t = await insert.text();
        console.error("Token insert failed", t);
        // Return 200 so Supabase doesn’t keep retrying, but include error for logs
        return new Response(`Token insert failed: ${t}`, { status: 200 });
      }
    }

    // -------- Send email via Mailtrap Send API --------
    // Required: MAILTRAP_TOKEN, MAIL_FROM
    // Optional: MAIL_FROM_NAME, REPLY_TO, PUBLIC_SITE_ORIGIN
    if (env.MAILTRAP_TOKEN && env.MAIL_FROM) {
      const origin = env.PUBLIC_SITE_ORIGIN || new URL(request.url).origin;
      const verifyUrl = `${origin}/api/verify?token=${encodeURIComponent(token)}`;

      const { subject, text, html, preheader } = buildEmail({
        name: lead.name || "",
        email,
        verifyUrl,
        origin,
      });

      const mtResp = await fetch("https://send.api.mailtrap.io/api/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.MAILTRAP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: {
            email: env.MAIL_FROM,
            name: env.MAIL_FROM_NAME || "HabitBlock",
          },
          to: [{ email, name: lead.name || "" }],
          subject,
          text,
          html,
          custom_headers: [
            { header: "X-Entity-Ref-ID", value: crypto.randomUUID() },
            { header: "X-Preheader", value: preheader },
          ],
          reply_to: env.REPLY_TO
            ? [{ email: env.REPLY_TO, name: "HabitBlock" }]
            : undefined,
          // Disable tracking for a transactional confirm (optional; comment out to enable)
          // category: "transactional",
        }),
      });

      // Mailtrap typically returns 200 on success. If not, log but return 200 to prevent webhook retries.
      if (!mtResp.ok) {
        const t = await mtResp.text();
        console.error("Mailtrap failed", t);
        return new Response(`Mailtrap failed: ${t}`, { status: 200 });
      }
    }

    return new Response("ok", { status: 200 });
  } catch (e: any) {
    console.error("Server error", e);
    return new Response(`Server error: ${String(e)}`, { status: 500 });
  }
};
