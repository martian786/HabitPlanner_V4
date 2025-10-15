// functions/api/resend.ts
const randomHex = (bytes = 32) => {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,"0")).join("");
};

async function hmacHex(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,"0")).join("");
}
function tsec(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0; for (let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const genericOk = (origin: string) => new Response(
  `<!doctype html><html><body style="font-family:system-ui;padding:40px">
  <h1>Thanks!</h1><p>If an account exists for that email, we’ve sent a new link.</p>
  <p><a href="${origin}/">Back to HabitBlock</a></p></body></html>`,
  { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
);

export const onRequest = async ({ request, env }: { request: Request; env: Record<string,string> }) => {
  try {
    const url = new URL(request.url);
    const origin = url.origin;
    const email = (url.searchParams.get("email") || "").trim().toLowerCase();
    const ts = url.searchParams.get("ts") || "";
    const sig = url.searchParams.get("sig") || "";

    if (!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE && email && ts && sig)) {
      return genericOk(origin);
    }

    // Verify short-lived signature (15 minutes)
    const maxAgeMs = 15 * 60 * 1000;
    const fresh = Math.abs(Date.now() - Number(ts)) <= maxAgeMs;
    const secret = env.RESEND_LINK_SECRET || env.SUPABASE_SERVICE_ROLE;
    const expect = await hmacHex(secret, `${email}|${ts}`);
    if (!fresh || !tsec(sig, expect)) return genericOk(origin);

    const sb = (path: string, init?: RequestInit) =>
      fetch(`${env.SUPABASE_URL}${path}`, {
        ...init,
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE!,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE!}`,
          ...(init?.headers || {}),
        },
      });

    // Find pending row (unused)
    const q = await sb(`/rest/v1/email_verifications?email=eq.${encodeURIComponent(email)}&used_at=is.null&select=created_at,updated_at,token`);
    if (!q.ok) return genericOk(origin);
    const pending = (await q.json())?.[0];

    // Cooldown: if created/updated < 15m ago, silently OK
    const lastTs = pending?.updated_at || pending?.created_at;
    if (lastTs && (Date.now() - new Date(lastTs).getTime()) < 15*60*1000) {
      return genericOk(origin);
    }

    const newToken = randomHex(32); // 64-char hex
    const newExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    if (pending) {
      // Rotate in place: new token + new expiry
      const patch = await sb(`/rest/v1/email_verifications?email=eq.${encodeURIComponent(email)}&used_at=is.null`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ token: newToken, expires_at: newExpiry }),
      });
      if (!patch.ok) return genericOk(origin);
    } else {
      // No pending row → create one
      const ins = await sb(`/rest/v1/email_verifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify([{ email, token: newToken, expires_at: newExpiry }]),
      });
      if (!ins.ok) return genericOk(origin);
    }

    // Send email via Mailtrap (same as your webhook style)
    if (env.MAILTRAP_TOKEN && env.MAIL_FROM) {
      const verifyUrl = `${origin}/api/verify?token=${encodeURIComponent(newToken)}`;
      const mt = await fetch("https://send.api.mailtrap.io/api/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.MAILTRAP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || "HabitBlock" },
          to: [{ email }],
          subject: "Confirm your email for HabitBlock",
          text: `Hi,\n\nPlease confirm your email:\n${verifyUrl}\n\n— HabitBlock`,
          html: `<p>Hi,</p><p>Please confirm your email for <strong>HabitBlock</strong>:</p>
                 <p><a href="${verifyUrl}" style="background:#9d0208;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">
                 Confirm email</a></p><p>— HabitBlock</p>`,
        }),
      });
      // Always return generic OK regardless of mt result to avoid info leaks/retries
      await mt.text().catch(() => null);
    }

    return genericOk(origin);
  } catch {
    return new Response("OK", { status: 200 }); // generic
  }
};
