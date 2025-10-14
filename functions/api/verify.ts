// functions/api/verify.ts
export const onRequest = async ({ request, env }: { request: Request; env: Record<string, string> }) => {
  try {
    const url = new URL(request.url);
    const token = (url.searchParams.get("token") || "").trim();

    if (!token) {
      return new Response("Missing token", { status: 400, headers: { "Content-Type": "text/plain" } });
    }

    if (!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE)) {
      return new Response("Server misconfigured", { status: 500, headers: { "Content-Type": "text/plain" } });
    }

    // 1) Fetch token row (not used & not expired)
    const getResp = await fetch(`${env.SUPABASE_URL}/rest/v1/email_verifications?token=eq.${encodeURIComponent(token)}&select=*`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
      },
    });

    if (!getResp.ok) {
      return new Response("Lookup failed", { status: 502, headers: { "Content-Type": "text/plain" } });
    }

    const rows = await getResp.json();
    const row = rows?.[0];
    if (!row) return new Response("Invalid or already used token", { status: 400 });

    if (row.used_at) {
      return new Response("Token already used", { status: 400 });
    }

    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return new Response("Token expired", { status: 400 });
    }

    // 2) Mark as used
    const nowIso = new Date().toISOString();
    const patch = await fetch(`${env.SUPABASE_URL}/rest/v1/email_verifications?token=eq.${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ used_at: nowIso }),
    });

    if (!patch.ok) {
      return new Response("Could not complete verification", { status: 502, headers: { "Content-Type": "text/plain" } });
    }

    // Optional: if you later add a verified flag on leads, you could update it here.

    // 3) Show a friendly page (or redirect)
    const origin = new URL(request.url).origin;
    const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <title>Email verified</title>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 40px; color: #111;}
      .card { max-width: 560px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; padding: 24px; }
      .btn { background:#9d0208;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Email verified ✅</h1>
      <p>Thanks! Your email is confirmed.</p>
      <p>We will be in touch soon. In the meantime you can read articles in our resources</p>
      <p><a class="btn" href="${origin}/">Back to HabitBlock</a></p>
    </div>
  </body>
</html>
`;
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e: any) {
    return new Response("Server error", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
};
