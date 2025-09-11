// supabase/functions/stripe-webhook/index.ts
// deno-lint-ignore-file no-explicit-any
import Stripe from "npm:stripe";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function upsertSubscription(payload: {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  price_id: string;
  status: string;
  current_period_end: number; // seconds
}) {
  console.log('🔄 Attempting to upsert subscription for user:', payload.user_id);
  
  const body = {
    user_id: payload.user_id,
    stripe_customer_id: payload.stripe_customer_id,
    stripe_subscription_id: payload.stripe_subscription_id,
    price_id: payload.price_id,
    status: payload.status,
    current_period_end: new Date(payload.current_period_end * 1000).toISOString(),
  };

  console.log('📋 Subscription data to insert:', body);

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

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('❌ Subscription insert failed:', resp.status, errorText);
    
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
    
    if (!patchResp.ok) {
      const patchError = await patchResp.text();
      console.error('❌ Subscription PATCH also failed:', patchResp.status, patchError);
      throw new Error(`Failed to upsert subscription: ${errorText} | PATCH: ${patchError}`);
    } else {
      console.log('✅ Subscription updated via PATCH');
    }
  } else {
    console.log('✅ Subscription created via POST');
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

      // Process subscription events
      if (event.type.startsWith('customer.subscription.')) {
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