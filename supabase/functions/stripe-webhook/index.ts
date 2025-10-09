// supabase/functions/stripe-webhook/index.ts
// deno-lint-ignore-file no-explicit-any
import Stripe from "npm:stripe";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function upsertSubscription(payload: {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  price_id: string;
  status: string;
  current_period_end?: number; // seconds - optional because it might be null for incomplete subscriptions
}) {
  console.log('🔄 Attempting to upsert subscription for user:', payload.user_id);
  console.log('📋 Raw payload received:', JSON.stringify(payload, null, 2));

  // Handle missing or invalid current_period_end (e.g., incomplete subscriptions)
  let periodEndISO: string;
  if (payload.current_period_end && !isNaN(payload.current_period_end)) {
    periodEndISO = new Date(payload.current_period_end * 1000).toISOString();
  } else {
    // Default to 1 year from now for incomplete subscriptions
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    periodEndISO = oneYearFromNow.toISOString();
    console.log('⚠️ Missing current_period_end, using default:', periodEndISO);
  }

  const body = {
    user_id: payload.user_id,
    stripe_customer_id: payload.stripe_customer_id,
    stripe_subscription_id: payload.stripe_subscription_id,
    price_id: payload.price_id,
    status: payload.status,
    current_period_end: periodEndISO,
  };

  console.log('📋 Subscription data to insert:', JSON.stringify(body, null, 2));
  console.log('🔧 Using Supabase URL:', supabaseUrl);
  console.log('🔧 Service role key exists:', !!serviceRoleKey);

  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        Prefer: "resolution=merge-duplicates",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    console.log('📡 POST Response status:', resp.status);
    const responseText = await resp.text();
    console.log('📡 POST Response body:', responseText);

    if (!resp.ok) {
      console.error('❌ Subscription insert failed:', resp.status, responseText);
      
      // Fallback: try update if already exists
      console.log('🔄 Trying PATCH fallback...');
      const patchResp = await fetch(
        `${supabaseUrl}/rest/v1/subscriptions?stripe_subscription_id=eq.${payload.stripe_subscription_id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      
      const patchResponseText = await patchResp.text();
      console.log('📡 PATCH Response status:', patchResp.status);
      console.log('📡 PATCH Response body:', patchResponseText);
      
      if (!patchResp.ok) {
        console.error('❌ Subscription PATCH also failed:', patchResp.status, patchResponseText);
        throw new Error(`Failed to upsert subscription: ${responseText} | PATCH: ${patchResponseText}`);
      } else {
        console.log('✅ Subscription updated via PATCH');
      }
    } else {
      console.log('✅ Subscription created via POST');
    }
  } catch (error) {
    console.error('❌ Database operation error:', error);
    throw error;
  }
}

serve(async (req) => {
  // Always return 200 to Stripe immediately (fire-and-forget pattern)
  const processWebhook = async () => {
    try {
      console.log('🎣 Stripe webhook received');
      
      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        return;
      }

      // Validate environment
      if (!supabaseUrl || !serviceRoleKey || !webhookSecret) {
        console.error('❌ Missing required environment variables');
        return;
      }

      const sig = req.headers.get("Stripe-Signature");
      if (!sig) {
        console.error("❌ Missing Stripe-Signature header");
        return;
      }

      const raw = await req.arrayBuffer();
      console.log('📦 Received payload size:', raw.byteLength, 'bytes');
      
      let event: Stripe.Event;

      try {
        event = await stripe.webhooks.constructEventAsync(
          new Uint8Array(raw),
          sig,
          webhookSecret,
        );
        console.log('✅ Webhook signature verified, event type:', event.type);
      } catch (err) {
        console.error("❌ Webhook signature verification failed:", err);
        return;
      }

      // Process checkout completion - primary source of user_id
      if (event.type === 'checkout.session.completed') {
        console.log('💳 Processing checkout session completed');
        const session = event.data.object as Stripe.Checkout.Session;
        
        const userId = session.metadata?.user_id;
        const subscriptionId = session.subscription as string;
        
        console.log('👤 User ID from session:', userId);
        console.log('📋 Subscription ID from session:', subscriptionId);
        
        if (!userId || !subscriptionId) {
          console.warn("❌ Missing user_id or subscription_id in checkout session");
          return;
        }

        // Retrieve the full subscription object to get price details
        try {
          console.log('🔍 Fetching subscription details from Stripe');
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          
          const item = subscription.items.data[0];
          console.log('💰 Processing price:', item.price.id);
          
          await upsertSubscription({
            user_id: userId,
            stripe_customer_id: typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer!.id,
            stripe_subscription_id: subscription.id,
            price_id: item.price.id,
            status: subscription.status,
            current_period_end: subscription.current_period_end!,
          });
          console.log('✅ Subscription created from checkout session');
        } catch (err) {
          console.error("❌ Checkout session processing failed:", err);
        }
      }
      
      // Process subscription events as backup
      else if (event.type.startsWith('customer.subscription.')) {
        console.log(`🔔 Processing subscription ${event.type}`);
        const sub = event.data.object as Stripe.Subscription;

        const userId = sub.metadata?.user_id;
        if (!userId) {
          console.warn("❌ Missing user_id metadata on subscription", sub.id);
          return;
        }

        const item = sub.items.data[0];
        console.log('💰 Processing price:', item.price.id);
        
        try {
          await upsertSubscription({
            user_id: userId,
            stripe_customer_id: typeof sub.customer === "string"
              ? sub.customer
              : sub.customer!.id,
            stripe_subscription_id: sub.id,
            price_id: item.price.id,
            status: sub.status,
            current_period_end: sub.current_period_end!,
          });
          console.log('✅ Subscription processed successfully');
        } catch (err) {
          console.error("❌ Subscription processing failed:", err);
        }
      } else {
        console.log('ℹ️ Ignoring event type:', event.type);
      }
    } catch (err) {
      console.error("❌ Webhook processing error:", err);
    }
  };

  // Fire and forget - process async but return 200 immediately
  processWebhook().catch(err => {
    console.error("❌ Async webhook processing error:", err);
  });

  // Always return 200 OK to Stripe
  return new Response("ok", { status: 200 });
});