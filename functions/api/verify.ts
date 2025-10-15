// functions/api/verify.ts
// GET -> render only (no DB writes). POST -> consume token (used_at).
// Expired tokens show a signed "Resend" link so only this page can trigger resend.

export const onRequest = async ({ request, env }: { request: Request; env: Record<string, string> }) => {
  try {
    const url = new URL(request.url);
    const origin = url.origin;

    if (!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE)) {
      return new Response("Server misconfigured", { status: 500, headers: { "Content-Type": "text/plain" } });
    }

    // --- helpers ---
    const text = (code: number, msg: string) =>
      new Response(msg, { status: code, headers: { "Content-Type": "text/plain; charset=utf-8" } });

    const html = (code: number, body: string, extraHeaders: Record<string, string> = {}) =>
      new Response(body, {
        status: code,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
      });

    const successHtml = (opts?: { already?: boolean }) => `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${opts?.already ? "Email already verified" : "Email verified"}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;padding:40px;color:#111}
.card{max-width:560px;margin:0 auto;border:1px solid #eee;border-radius:12px;padding:24px}
.btn{background:#9d0208;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block}</style>
</head><body><div class="card">
<h1>${opts?.already ? "Email already verified ✅" : "Email verified ✅"}</h1>
<p>${opts?.already ? "Your email was previously confirmed. You're all set." : "Thanks! Your email is confirmed."}</p>
<p>We will be in touch soon. In the meantime you can read articles on our resources page.</p>
<p><a class="btn" href="${origin}/">Back to HabitBlock</a></p>
</div></body></html>`;

    // NOTE: now takes an optional resendHref (signed). If absent, no button shown.
    const errorHtml = (message: string, resendHref?: string) => `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Verification problem</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;padding:40px;color:#111}
.card{max-width:560px;margin:0 auto;border:1px solid #eee;border-radius:12px;padding:24px}
.btn{background:#9d0208;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block}</style>
</head><body><div class="card">
<h1>Couldn’t verify</h1>
<p>${message}</p>
${resendHref ? `<p><a class="btn" href="${resendHref}">Resend verification email</a></p>` : ``}
<p><a href="${origin}/">Back to HabitBlock</a></p>
</div></body></html>`;

    const confirmPageHtml = (token: string) => `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Confirming…</title>
<script>
// Auto-POST to consume the token. Scanners usually don't execute JS.
async function go(){
  try{
    const r = await fetch("${origin}/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "${token}" }),
      credentials: "same-origin",
    });
    const t = await r.text();
    document.open(); document.write(t); document.close();
  }catch(e){
    document.body.innerHTML = '<p>Network error. Please refresh.</p>';
  }
}
addEventListener('DOMContentLoaded', go);
</script>
</head><body>
<p>Confirming your email…</p>
<noscript>
  <form method="POST" action="${origin}/api/verify">
    <input type="hidden" name="token" value="${token}"/>
    <button type="submit">Confirm my email</button>
  </form>
</noscript>
</body></html>`;

    // HMAC helper to sign resend links (prevents abuse)
    async function hmacHex(secret: string, data: string) {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
      return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,"0")).join("");
    }

    const supabase = async (path: string, init?: RequestInit) =>
      fetch(`${env.SUPABASE_URL}${path}`, {
        ...init,
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE!,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE!}`,
          ...(init?.headers || {}),
        },
      });

    // HEAD/OPTIONS should never consume anything
    if (request.method === "HEAD") return new Response(null, { status: 204 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });

    if (request.method === "GET") {
      const token = (new URL(request.url).searchParams.get("token") || "").trim();
      if (!token) return text(400, "Missing token");

      // Lookup token
      const getResp = await supabase(`/rest/v1/email_verifications?token=eq.${encodeURIComponent(token)}&select=*`);
      if (!getResp.ok) return text(502, "Lookup failed");

      const rows = await getResp.json();
      const row = rows?.[0];
      if (!row) return html(200, errorHtml("This verification link is invalid or has expired."));

      // Expired?
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
        // Build a short-lived, signed resend link bound to this email
        const secret = env.RESEND_LINK_SECRET || env.SUPABASE_SERVICE_ROLE; // fallback to SR if needed
        const ts = Date.now().toString();
        const sig = await hmacHex(secret, `${row.email}|${ts}`);
        const resendHref = `${origin}/api/resend?email=${encodeURIComponent(row.email)}&ts=${ts}&sig=${sig}`;
        return html(200, errorHtml("This verification link is invalid or has expired.", resendHref));
      }

      // Already used → idempotent display with "already verified" copy
      if (row.used_at) {
        return html(200, successHtml({ already: true }));
      }

      // Valid + unused → show interstitial that auto-POSTs
      return html(200, confirmPageHtml(token));
    }

    if (request.method === "POST") {
      // Accept JSON body or form fallback (from <noscript>)
      let token = "";
      const ctype = request.headers.get("content-type") || "";
      if (ctype.includes("application/json")) {
        const body = await request.json().catch(() => null);
        token = (body?.token || "").trim();
      } else if (ctype.includes("application/x-www-form-urlencoded")) {
        const form = await request.formData();
        token = (form.get("token") as string || "").trim();
      } else {
        return text(400, "Bad request");
      }

      if (!token) return text(400, "Missing token");

      // Re-fetch to validate existence/expiry
      const getResp = await supabase(`/rest/v1/email_verifications?token=eq.${encodeURIComponent(token)}&select=*`);
      if (!getResp.ok) return text(502, "Lookup failed");
      const rows = await getResp.json();
      const row = rows?.[0];
      if (!row) return html(200, errorHtml("This verification link is invalid or has expired."));
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
        const secret = env.RESEND_LINK_SECRET || env.SUPABASE_SERVICE_ROLE;
        const ts = Date.now().toString();
        const sig = await hmacHex(secret, `${row.email}|${ts}`);
        const resendHref = `${origin}/api/resend?email=${encodeURIComponent(row.email)}&ts=${ts}&sig=${sig}`;
        return html(200, errorHtml("This verification link is invalid or has expired.", resendHref));
      }

      // Consume token atomically: only if currently unused
      const nowIso = new Date().toISOString();
      const patch = await supabase(
        `/rest/v1/email_verifications?token=eq.${encodeURIComponent(token)}&used_at=is.null`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ used_at: nowIso }),
        }
      );

      if (!patch.ok) {
        return text(502, "Could not complete verification");
      }

      const updated = await patch.json();

      if (!Array.isArray(updated) || updated.length === 0) {
        // Already used between GET and POST → show "already verified" copy
        return html(200, successHtml({ already: true }));
      }

      // (Optional) mark user/lead verified here.

      return html(200, successHtml());
    }

    return text(405, "Method not allowed");
  } catch {
    return new Response("Server error", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
};
