// functions/api/confirm-email.ts
const randomToken = (len = 32) => {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const basicAuth = (user: string, pass: string) =>
  "Basic " + btoa(`${user}:${pass}`);

export const onRequest = async ({ request, env }: { request: Request; env: Record<string,string> }) => {
  try {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Supabase DB Webhook body shape: { type:"INSERT", table:"leads", record:{...} , ... }
    const payload = await request.json().catch(() => ({} as any));
    const lead = payload?.record || {};
    const email = String(lead.email || "").trim().toLowerCase();
    if (!email) return new Response("Missing email", { status: 400 });

    // Optional idempotency: if you get duplicate webhook deliveries, you can no-op
    // e.g., skip if a non-expired verification already exists for this email.
    if (!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE)) {
      return new Response("Server misconfigured", { status: 500 });
    }

    // Look for an existing, unused, unexpired token to avoid spamming:
    const check = await fetch(`${env.SUPABASE_URL}/rest/v1/email_verifications?email=eq.${encodeURIComponent(email)}&used_at=is.null&select=token,expires_at&order=created_at.desc&limit=1`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      },
    });
    if (!check.ok) {
      return new Response("Lookup failed", { status: 502 });
    }
    const existing = await check.json();
    const stillValid = existing?.[0] && new Date(existing[0].expires_at).getTime() > Date.now();

    // Either reuse recent token or create a new one
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
        // Don’t fail the webhook—just report for logs
        const t = await insert.text();
        return new Response(`Token insert failed: ${t}`, { status: 502 });
      }
    }

    // Send Mailgun (skip silently if not configured)
    if (env.MAILGUN_DOMAIN && env.MAILGUN_API_KEY && env.MAIL_FROM) {
      const origin = env.PUBLIC_SITE_ORIGIN || new URL(request.url).origin;
      const verifyUrl = `${origin}/api/verify?token=${encodeURIComponent(token)}`;

      const mgResp = await fetch(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
        method: "POST",
        headers: {
          Authorization: basicAuth("api", env.MAILGUN_API_KEY),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          from: env.MAIL_FROM,
          to: email,
          subject: "Confirm your email for HabitBlock",
          text:
            `Hi${lead.name ? " " + lead.name : ""},\n\n` +
            `Thanks for reserving early access to HabitBlock.\n\n` +
            `Confirm your email:\n${verifyUrl}\n\n— HabitBlock`,
          html:
            `<p>Hi${lead.name ? " " + lead.name : ""},</p>` +
            `<p>Thanks for reserving early access to <strong>HabitBlock</strong>.</p>` +
            `<p><a href="${verifyUrl}" style="background:#9d0208;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Confirm email</a></p>` +
            `<p>— HabitBlock</p>`,
        }),
      });
      if (!mgResp.ok) {
        const t = await mgResp.text();
        // Return 200 so Supabase doesn’t retry forever; you can monitor logs
        return new Response(`Mailgun failed: ${t}`, { status: 200 });
      }
    }

    return new Response("ok", { status: 200 });
  } catch (e: any) {
    return new Response(`Server error: ${String(e)}`, { status: 500 });
  }
};
