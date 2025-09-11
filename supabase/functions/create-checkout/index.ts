// supabase/functions/create-checkout/index.ts
// deno-lint-ignore-file no-explicit-any
import Stripe from "npm:stripe";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

type Body = { priceId: string };

serve(async (req) => {
  // CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  } as const;

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    console.log('🚀 Create-checkout function called with method:', req.method);
    
    if (req.method !== "POST") {
      console.log('❌ Method not allowed:', req.method);
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    // Create a Supabase client bound to the caller's JWT to get the user
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    console.log('🔧 Creating Supabase client with URL:', supabaseUrl);
    
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    
    console.log('🔐 Getting user from session...');
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      console.error('❌ User authentication failed:', userErr);
      return new Response(JSON.stringify({ error: "Unauthorized", details: userErr?.message }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    
    console.log('✅ User authenticated:', user.email, user.id);

    const { priceId } = (await req.json()) as Body;
    console.log('💰 Price ID received:', priceId);
    
    if (!priceId) {
      console.error('❌ Missing priceId in request body');
      return new Response(JSON.stringify({ error: "Missing priceId" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Attempt to find an existing Stripe customer via current subscription
    const res = await fetch(
      `${supabaseUrl}/rest/v1/subscriptions?select=stripe_customer_id&user_id=eq.${user.id}&limit=1`,
      {
        headers: {
          apiKey: anonKey,
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          Prefer: "return=representation",
        },
      },
    );
    const subs = await res.json() as Array<{ stripe_customer_id: string }>;
    let customerId = subs?.[0]?.stripe_customer_id;

    if (!customerId) {
      // Create a new customer if none exists yet
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      // Saved later by webhook on session completion
    }

    const siteUrl = Deno.env.get("SITE_URL") || "http://localhost:5173";
    console.log('🌐 Site URL for redirects:', siteUrl);
    console.log('🛒 Creating Stripe checkout session...');
    
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${siteUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/?payment=cancelled`,
      subscription_data: { metadata: { user_id: user.id } },
      metadata: { user_id: user.id, price_id: priceId },
    });

    console.log('✅ Checkout session created:', checkout.id);
    console.log('🔗 Checkout URL:', checkout.url);

    return new Response(JSON.stringify({ url: checkout.url }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
      status: 200,
    });
  } catch (err) {
    console.error('Checkout error:', err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ 
      error: "Checkout failed",
      details: errorMessage,
      timestamp: new Date().toISOString(),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
