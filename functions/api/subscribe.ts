// functions/api/subscribe.ts
export const onRequest = async ({ request, env }: { request: Request; env: Record<string, string> }) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (request.method === "GET") {
      return new Response(JSON.stringify({ ok: true, route: "/api/subscribe" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS });
    }

    // Parse form safely
    const form = await request.formData();

    // Honeypot (quietly accept)
    if (String(form.get("company_website") || "").trim()) {
      return new Response("ok", { status: 200, headers: CORS });
    }

    // Email validation
    const email = String(form.get("email") || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response("Invalid email", { status: 400, headers: CORS });
    }

    // Turnstile — make dev/preview forgiving
    let turnstilePassed = true;
    try {
      // Skip captcha on preview hosts to avoid dev pain
      const host = new URL(request.url).hostname;
      const isPreview = host.endsWith(".pages.dev");
      if (!isPreview) {
        const token = String(form.get("cf-turnstile-response") || "");
        const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          body: new URLSearchParams({
            secret: env.TURNSTILE_SECRET || "",
            response: token,
            remoteip: request.headers.get("CF-Connecting-IP") || "",
          }),
        }).then((r) => r.json());
        turnstilePassed = !!verify?.success;
      }
    } catch {
      turnstilePassed = false;
    }
    if (!turnstilePassed) {
      return new Response("Captcha failed", { status: 400, headers: CORS });
    }

    // Collect fields (safe defaults)
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
      feature_hook: String(form.get("feature_hook") || ""),     // NEW
      use_case_note: String(form.get("use_case_note") || ""), 
      user_agent: request.headers.get("user-agent") || "",
      ip: request.headers.get("CF-Connecting-IP") || "",
      source: "pricing-modal",
    };

    // Parallel writes (never throw)
    let basinStatus: number | null = null;
    if (env.BASIN_ENDPOINT) {
      try {
        const r = await fetch(env.BASIN_ENDPOINT, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(record as Record<string, string>),
        });
        basinStatus = r.status;
      } catch {
        basinStatus = 599;
      }
    }

    let supabaseStatus: number | null = null;
    let supabaseBody: string | null = null;
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE) {
      try {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/leads?on_conflict=email`, {
          method: "POST",
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(record),
        });
        supabaseStatus = r.status;
        if (!r.ok) supabaseBody = (await r.text()).slice(0, 400);
        if (!r.ok) {
          // Surface clear JSON instead of a CF 502 HTML page
          return new Response(JSON.stringify({ error: "Supabase insert failed", status: supabaseStatus, body: supabaseBody }), {
            status: 502,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }
      } catch (e: any) {
        return new Response(JSON.stringify({ error: "Supabase network error", message: String(e) }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
    }

    return new Response("ok", { status: 200, headers: CORS });
  } catch (e: any) {
    // Never let exceptions bubble to a 502 HTML
    return new Response(`Server error: ${String(e)}`, { status: 500 });
  }
};
