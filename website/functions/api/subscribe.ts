export const onRequest = async ({ request, env }: { request: Request; env: Record<string, string> }) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method === "GET") {
    return new Response(JSON.stringify({ ok: true, route: "/api/subscribe" }), {
      status: 200, headers: { "Content-Type": "application/json", ...CORS }
    });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  try {
    const form = await request.formData();

    // honeypot
    if (String(form.get("company_website") || "").trim()) return new Response("ok", { status: 200, headers: CORS });

    // email validation
    const email = String(form.get("email") || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return new Response("Invalid email", { status: 400, headers: CORS });

    // Turnstile (only in Pages env)
    if (env.CF_PAGES) {
      const token = String(form.get("cf-turnstile-response") || "");
      const verify: any = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: token,
          remoteip: request.headers.get("CF-Connecting-IP") || ""
        })
      }).then(r => r.json());
      if (!verify?.success) return new Response("Captcha failed", { status: 400, headers: CORS });
    }

    const record = {
      name: String(form.get("name") || ""),
      email,
      plan: String(form.get("plan") || ""),
      page_url: String(form.get("page_url") || ""),
      utm_source: String(form.get("utm_source") || ""),
      utm_campaign: String(form.get("utm_campaign") || ""),
      utm_medium: String(form.get("utm_medium") || ""),
      first_click_plan: String(form.get("first_click_plan") || ""),
      ga_client_id: String(form.get("ga_client_id") || ""),
      user_agent: request.headers.get("user-agent") || "",
      ip: request.headers.get("CF-Connecting-IP") || "",
      source: "pricing-modal"
    };

    // optional Basin
    const basinPromise = env.BASIN_ENDPOINT
      ? fetch(env.BASIN_ENDPOINT, {
          method: "POST",
          headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(record as Record<string, string>)
        }).catch(() => new Response(null, { status: 599 }))
      : Promise.resolve(new Response(null, { status: 204 }));

    // Supabase (source of truth)
    const supabasePromise = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE
      ? fetch(`${env.SUPABASE_URL}/rest/v1/leads?on_conflict=email`, {
          method: "POST",
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal"
          },
          body: JSON.stringify(record)
        }).catch(() => new Response(null, { status: 599 }))
      : Promise.resolve(new Response(null, { status: 204 }));

    const [basinRes, supaRes] = await Promise.all([basinPromise, supabasePromise]);

    if (env.SUPABASE_URL && (!supaRes || !supaRes.ok)) {
      return new Response("Storage error", { status: 502, headers: CORS });
    }
    return new Response("ok", { status: 200, headers: CORS });
  } catch (e) {
    return new Response("Server error", { status: 500, headers: CORS });
  }
};
