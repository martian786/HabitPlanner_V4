// functions/api/subscribe.ts

export const onRequestPost = async ({ request, env }: { request: Request; env: Record<string, string> }) => {
  try {
    const form = await request.formData();

    // 0) Honeypot (drop quietly)
    if (String(form.get("company_website") || "").trim()) {
      return new Response("ok", { status: 200 });
    }

    // 1) Validate email
    const email = String(form.get("email") || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response("Invalid email", { status: 400 });
    }

    // 2) Verify Turnstile (server-side)
    const token = String(form.get("cf-turnstile-response") || "");
    const verify: any = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: request.headers.get("CF-Connecting-IP") || ""
      })
    }).then((r) => r.json());

    if (!verify?.success) {
      return new Response("Captcha failed", { status: 400 });
    }

    // 3) Collect fields (keep names aligned with your modal)
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

    // 4) Forward to Basin (optional) and upsert to Supabase (both in parallel)
    const basinBody = new URLSearchParams();
    Object.entries(record as Record<string, unknown>).forEach(([k, v]) => {
      basinBody.append(k, String(v ?? ""));
    });

    const basinPromise = env.BASIN_ENDPOINT
      ? fetch(env.BASIN_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: basinBody
        })
      : Promise.resolve(new Response(null, { status: 204 }));

    const supabasePromise = fetch(`${env.SUPABASE_URL}/rest/v1/leads?on_conflict=email`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(record)
    });

    // Run in parallel; treat Supabase as source of truth
    const [basinRes, supaRes] = await Promise.all([
      basinPromise.catch(() => new Response(null, { status: 599 })),
      supabasePromise.catch(() => new Response(null, { status: 599 }))
    ]);

    if (!supaRes.ok) {
      return new Response("Storage error", { status: 502 });
    }
    // Basin can fail without blocking success
    if (!basinRes.ok) {
      // You could log this to a logging service
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response("Server error", { status: 500 });
  }
};
