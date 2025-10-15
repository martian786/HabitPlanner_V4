// functions/api/confirm-email.ts

const randomToken = (len = 32) => {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const basicAuth = (user: string, pass: string) =>
  "Basic " + btoa(`${user}:${pass}`);

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

    // Shared-secret header from Supabase Webhooks UI (Header: X-Webhook-Token)
    const tokenHeader =
      request.headers.get("x-webhook-token") || request.headers.get("X-Webhook-Token");
    if (!env.WEBHOOK_TOKEN || !tokenHeader || tokenHeader !== env.WEBHOOK_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Body: { type:"INSERT", table:"leads", record:{...} }
    const payload = await request.json().catch(() => ({} as any));
    const eventType = payload?.type || payload?.event;
    const table = payload?.table || payload?.table_name;
    if (table !== "leads" || eventType !== "INSERT") {
      return new Response("Ignored", { status: 200 });
    }

    const lead = payload?.record || {};
    const email = String(lead.email || "").trim().toLowerCase();
    if (!email) return new Response("Missing email", { status: 400 });

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
    if (!check.ok) return new Response("Lookup failed", { status: 502 });
    const existing = await check.json();
    const stillValid =
      existing?.[0] && new Date(existing[0].expires_at).getTime() > Date.now();

    const token = stillValid ? existing[0].token : randomToken(32);

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
        return new Response(`Token insert failed: ${t}`, { status: 200 });
      }
    }

    // -------- Mailtrap Send API --------
    // Required env vars:
    // MAILTRAP_TOKEN, MAIL_FROM (e.g., "no-reply@yourdomain.com")
    // Optional: MAIL_FROM_NAME, PUBLIC_SITE_ORIGIN
    if (env.MAILTRAP_TOKEN && env.MAIL_FROM) {
      const origin = env.PUBLIC_SITE_ORIGIN || new URL(request.url).origin;
      const verifyUrl = `${origin}/api/verify?token=${encodeURIComponent(token)}`;

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
          subject: "Confirm your early access to HabitBlock ✅",
          text:
            `Hi${lead.name ? " " + lead.name : ""},\n\n` +
            `Thanks for signing up for early access to HabitBlock.\n\n` +
            `Confirm your email to secure your spot and get early feature access:\n` +
            `${verifyUrl}\n\n` +
            `Once you confirm, you'll:\n` +
            `• Be among the first to try HabitBlock\n` +
            `• Get priority updates and early features\n` +
            `• Help shape the app with your feedback\n\n` +
            `— The HabitBlock Team`,
          html:
            `<p style="margin:0 0 12px 0;">Hi${lead.name ? " " + lead.name : ""},</p>` +
            `<p style="margin:0 0 16px 0;">Thanks for signing up for <strong>early access to HabitBlock</strong> — we’re excited to have you on board!</p>` +
            `<p style="margin:0 0 16px 0;">To secure your spot and get notified when we launch, please confirm your email:</p>` +
            `<p style="margin:0 0 20px 0;">` +
              `<a href="${verifyUrl}" style="background:#9d0208;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Confirm my email</a>` +
            `</p>` +
            `<p style="margin:0 0 10px 0;"><strong>After you confirm, you’ll:</strong></p>` +
            `<ul style="margin:0 0 18px 20px; padding:0;">` +
              `<li>Be among the first to try HabitBlock</li>` +
              `<li>Get priority updates and early features</li>` +
              `<li>Help shape the app with your feedback</li>` +
            `</ul>` +
            `<p style="margin:12px 0 0 0;">— The HabitBlock Team</p>`,
        }),
      });

      // Mailtrap returns 200 on success; if it fails, log-friendly but OK 200 to avoid endless retries
      if (!mtResp.ok) {
        const t = await mtResp.text();
        return new Response(`Mailtrap failed: ${t}`, { status: 200 });
      }
    }

    return new Response("ok", { status: 200 });
  } catch (e: any) {
    return new Response(`Server error: ${String(e)}`, { status: 500 });
  }
};
