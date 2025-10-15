// functions/api/subscribe.ts
//Updated to make form more secure against mail bombing
// Solid anti - abuse: sanitization, Cloudflare Turnstile, KV - based IP rate - limiting,
//   role - address blocklist.
// This endpoint does not handle resend; it’s only for initial signups.

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

const oneOf = <T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T
) => ((allowed as readonly string[]).includes(String(v)) ? (v as T) : fallback);

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
  const allowed = uniq.filter((k) =>
    (FEATURE_KEYS as readonly string[]).includes(k)
  );
  return allowed.slice(0, maxItems).join(",");
};

const upper2 = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 2);

// quick, non-exhaustive currency map; safe as a *hint* only
const CTRY_TO_CCY: Record<string, string> = {
  US: "USD",
  GB: "GBP",
  IE: "EUR",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  BE: "EUR",
  PT: "EUR",
  AT: "EUR",
  FI: "EUR",
  GR: "EUR",
  EE: "EUR",
  LV: "EUR",
  LT: "EUR",
  SK: "EUR",
  SI: "EUR",
  CY: "EUR",
  MT: "EUR",
  LU: "EUR",
  // non-euro examples
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  IN: "INR",
  SG: "SGD",
  JP: "JPY",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
};

// ------------------- security additions (non-breaking defaults) -------------------

// Lightweight, safer email regex + length guard (doesn't "overvalidate")
const isValidEmail = (email: string) => {
  if (!email || email.length > 320) return false;
  // local@domain.tld (very permissive but avoids spaces/control chars)
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
};

// Basic disposable list (extend via env.DISPOSABLE_DOMAINS CSV)
const DEFAULT_DISPOSABLE = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.email",
  "yopmail.com",
  "trashmail.com",
  "dispostable.com",
  "getnada.com",
]);

const isDisposable = (domain: string, extraCsv?: string) => {
  const list = new Set(DEFAULT_DISPOSABLE);
  if (extraCsv) {
    for (const d of extraCsv.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)) {
      list.add(d);
    }
  }
  return list.has(domain);
};

// Optional role account block (only active if env.BLOCK_ROLE_EMAILS==="1")
const ROLE_LOCALPART = new Set([
  "admin","administrator","root","webmaster","postmaster","abuse","support",
  "info","sales","hello","contact","security","noc","help","billing"
]);
const isRoleAddress = (local: string) => ROLE_LOCALPART.has(local);

// Minimal KV interface for type safety
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

// KV-backed sliding window rate limit (skips if KV not bound)
const rlKey = (ip: string) => `rl:${ip}`;

async function hitRateLimit(env: Record<string, string | KVNamespace>, ip: string | null) {
  try {
    if (!ip) return false;
    const kv = env.SUBSCRIBE_RL as KVNamespace | undefined;
    if (!kv || typeof kv.get !== "function") return false; // KV not bound → skip

    // --- Rate limiting config ---
    // These can now be adjusted from Cloudflare Pages environment variables.
    // Defaults remain 10 attempts / 10 minutes if not set.
    const RL_LIMIT = Number(env.RL_LIMIT ?? 10);
    const RL_WINDOW_SEC = Number(env.RL_WINDOW_SEC ?? 600);
    console.log("Rate limit config:", RL_LIMIT, "attempts per", RL_WINDOW_SEC, "seconds");

    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / RL_WINDOW_SEC);
    const storageKey = `${rlKey(ip)}:${window}`;
    const current = parseInt((await kv.get(storageKey)) || "0", 10);
    console.log(`Rate limit check for IP ${ip}: ${current}/${RL_LIMIT}`);

    if (current >= RL_LIMIT) return true;
    await kv.put(storageKey, String(current + 1), { expirationTtl: RL_WINDOW_SEC + 60 });
    return false;
  } catch (err) {
    console.error("Rate limit error:", err);
    return false; // fail-open (non-breaking)
  }
}

// Optional form-duration guard if front-end sends hidden "ts" (ms epoch)
const tooFastOrStale = (clientTsMs: number | null, now = Date.now()) => {
  if (!clientTsMs || isNaN(clientTsMs)) return false;
  const delta = now - clientTsMs;
  if (delta < 800) return true;                     // < 0.8s (likely bot)
  if (delta > 30 * 60 * 1000) return true;          // > 30 min (stale)
  return false;
};

// ---------- handler ----------
export const onRequest = async ({
  request,
  env,
}: {
  request: Request;
  env: Record<string, string | any>;
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

    // Optional form duration check (non-breaking: only enforces if "ts" present)
    const tsRaw = String(form.get("ts") ?? "") || "";
    const tsNum = tsRaw ? Number(tsRaw) : null;
    if (tooFastOrStale(tsNum)) {
      // Don't reveal signal to bots; 200 "ok" keeps UX identical
      return new Response("ok", { status: 200, headers: CORS });
    }

    // Extract IP early for RL and logging
    const ip = sanitizeStr(request.headers.get("CF-Connecting-IP"), 64);

    // Per-IP rate limiting (KV-backed; silently disabled if KV not present)
    if (await hitRateLimit(env, ip || null)) {
      // Keep the body generic; 429 is standard and non-breaking for clients
      return new Response("Too many requests", { status: 429, headers: CORS });
    }

    // Email validation
    const email = String(form.get("email") || "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      return new Response("Invalid email", { status: 400, headers: CORS });
    }

    // Disposable / role email checks (role is opt-in)
    const [localPart, domainPart = ""] = email.split("@");
    const domain = domainPart.toLowerCase();
    if (isDisposable(domain, String(env.DISPOSABLE_DOMAINS || ""))) {
      // Soft deny with 200 to avoid becoming an oracle for bots
      return new Response("ok", { status: 200, headers: CORS });
    }
    if (String(env.BLOCK_ROLE_EMAILS || "") === "1" && isRoleAddress(localPart)) {
      // Optional strict block
      return new Response("Unsupported email", { status: 400, headers: CORS });
    }

    // Turnstile — dev/preview bypass is explicitly controlled
    let turnstilePassed = true;
    try {
      const host = new URL(request.url).hostname;
      const isPreviewHost = host.endsWith(".pages.dev");
      const allowPreviewBypass = String(env.TURNSTILE_BYPASS_PREVIEW || "") === "1";
      const mustVerify = !(isPreviewHost && allowPreviewBypass);

      if (mustVerify) {
        const token = String(form.get("cf-turnstile-response") || "");
        if (!token) throw new Error("missing token");
        const verify = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            body: new URLSearchParams({
              secret: String(env.TURNSTILE_SECRET || ""),
              response: token,
              remoteip: request.headers.get("CF-Connecting-IP") || "",
            }),
          }
        ).then((r) => r.json());
        turnstilePassed = !!verify?.success;
      }
    } catch {
      turnstilePassed = false;
    }
    if (!turnstilePassed) {
      return new Response("Captcha failed", { status: 400, headers: CORS });
    }

    // -------- collect + sanitize fields (client-provided) --------
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
    const use_case_note = sanitizeStr(form.get("use_case_note"), 180); // server-side cap

    // region/pricing helpers from client (hidden inputs)
    let timezone = sanitizeStr(form.get("timezone"), 64);
    const locale = sanitizeStr(form.get("locale"), 32);
    let currency_guess = sanitizeStr(form.get("currency_guess"), 8);

    const user_agent = sanitizeStr(request.headers.get("user-agent"), 300);

    // -------- server-side geo enrichment (Cloudflare) --------
    const cf: any = (request as any).cf || {};
    const cfCountry = upper2(request.headers.get("cf-ipcountry") || cf.country);
    const cfRegion =
      sanitizeStr(cf.region || cf.regionCode || cf.subdivision, 80) || "";
    const cfTz = sanitizeStr(cf.timezone, 64);

    // prefer client timezone if present, else use CF
    if (!timezone && cfTz) timezone = cfTz;

    // prefer client currency_guess if present, else map from CF country
    if (!currency_guess && cfCountry) {
      currency_guess = CTRY_TO_CCY[cfCountry] || "";
    }

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

      // insights
      feature_hook,
      use_case_note,

      // region/pricing helpers
      country_code: cfCountry || "",
      region_name: cfRegion,
      timezone,
      locale,
      currency_guess,

      // technical/context
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
        const r = await fetch(
          `${env.SUPABASE_URL}/rest/v1/leads?on_conflict=email`,
          {
            method: "POST",
            headers: {
              apikey: String(env.SUPABASE_SERVICE_ROLE),
              Authorization: `Bearer ${String(env.SUPABASE_SERVICE_ROLE)}`,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates,return=minimal",
            },
            body: JSON.stringify(record),
          }
        );
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
