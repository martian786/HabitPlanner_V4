// functions/api/subscribe.ts

// ---------- helpers ----------
const sanitizeStr = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const safeUrl = (v: unknown, max = 2048) => {
  const s = String(v ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return s.slice(0, max);
    }
  } catch {}
  return "";
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T) =>
  (allowed as readonly string[]).includes(String(v)) ? (v as T) : fallback;

// Match your <button class="hb-chip" data-value="..."> values in pricing.html
const FEATURE_KEYS = [
  "visual_planning",
  "key_blocks",
  "daily_blocks",
  "reflection",
  "analytics",
  "templates",
  "other",
] as const;

const normalizeFeatureHook = (v: unknown, maxItems = 6) => {
  const uniq = Array.from(
    new Set(
      String(v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
  const allowed = uniq.filter((k) => (FEATURE_KEYS as readonly string[]).includes(k));
  return allowed.slice(0, maxItems).join(",");
};

// ---------- handler ----------
export const onRequest = async ({
  request,
  env,
}: {
  request: Request;
  env: Record<string, string>;
}) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  } as const;

  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

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

    // -------- collect + sanitize fields --------
    const name = sanitizeStr(form.get("name"), 120);
    const plan = oneOf(form.get("plan"), ["pro", "plus", "cta", "footer"] as const, "pro");

    const page_url = safeUrl(form.get("page_url"));
    const utm_source = sanitizeStr(form.get("utm_source"), 100);
    const utm_campaign = sanitizeStr(form.get("utm_campaign"), 100);
    const utm_medium = sanitizeStr(form.get("utm_medium"), 100);

    const first_click_plan = oneOf(
      form.get("first_click_plan"),
      ["pro", "plus", "cta", "footer"] as const,
      ""
    );

    const ga_client_id = sanitizeStr(form.get("ga_client_id"), 64);
    const feature_hook = normalizeFeatureHook(form.get("feature_hook")); // CSV → cleaned CSV
    const use_case_note = sanitizeStr(form.get("use_case_note"), 180); // enforce server-side cap

    const user_agent = sanitizeStr(request.headers.get("user-agent"), 300);
    const ip = sanitizeStr(request.headers.get("CF-Connecting-IP"), 64);

    const record: Record<string, string> = {
      name,
      email,
      plan,
      page_url,
      utm_source,
      utm_campaign,
      utm_medium,
      first_click_plan,
      ga_client_id,
      feature_hook,
      use_case_note,
      user_agent,
      ip,
      source: "pricing-modal",
    };

    // -------- parallel writes (never throw) --------
    let basinStatus: number | null = null;
    if (env.BASIN_ENDPOINT) {
      try {
        const r = await fetch(env.BASIN_ENDPOINT, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(record),
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
          return new Response(
            JSON.stringify({
              error: "Supabase insert failed",
              status: supabaseStatus,
              body: supabaseBody,
            }),
            { status: 502, headers: { "Content-Type": "application/json", ...CORS } }
          );
        }
      } catch (e: any) {
        return new Response(
          JSON.stringify({ error: "Supabase network error", message: String(e) }),
          { status: 502, headers: { "Content-Type": "application/json", ...CORS } }
        );
      }
    }

    return new Response("ok", { status: 200, headers: CORS });
  } catch (e: any) {
    // Never let exceptions bubble to a 502 HTML
    return new Response(`Server error: ${String(e)}`, { status: 500 });
  }
};
