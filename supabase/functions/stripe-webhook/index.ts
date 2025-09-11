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
  try {
    console.log('🎣 Stripe webhook received');
    console.log('🔧 Request method:', req.method);
    console.log('🔧 Headers:', Object.fromEntries(req.headers.entries()));
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'stripe-signature, content-type',
        },
      });
    }

    // Debug environment
    console.log('🔧 Environment check:');
    console.log('- SUPABASE_URL exists:', !!supabaseUrl);
    console.log('- SERVICE_ROLE_KEY exists:', !!serviceRoleKey);
    console.log('- WEBHOOK_SECRET exists:', !!webhookSecret);

    const sig = req.headers.get("Stripe-Signature");
    if (!sig) {
      console.error("❌ Missing Stripe-Signature header");
      return new Response("Missing signature", { status: 400 });
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
      console.error("❌ Webhook secret used:", webhookSecret ? `${webhookSecret.substring(0, 10)}...` : 'MISSING');
      console.error("❌ Signature received:", sig);
      return new Response(`Invalid signature: ${err}`, { status: 400 });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          console.log('💳 Checkout session completed:', session.id);
          // no-op; the subscription.* events below will carry the full object
          break;
        }

        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          console.log(`🔔 Processing subscription ${event.type}`);
          const sub = event.data.object as Stripe.Subscription;

          // The user_id was put in metadata at checkout
          const userId = (sub.metadata?.user_id ||
            (sub.latest_invoice as any)?.metadata?.user_id) as string | undefined;

          console.log('👤 Found user_id in metadata:', userId);
          console.log('📋 Subscription metadata:', sub.metadata);

          // If not in metadata, try by customer search (optional)
          if (!userId) {
            console.warn("❌ Missing user_id metadata on subscription", sub.id);
            console.log('🔍 Full subscription object:', JSON.stringify(sub, null, 2));
            break;
          }

          const item = sub.items.data[0]; // single price model
          console.log('💰 Processing price:', item.price.id);
          
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
          break;
        }
        default:
          console.log('ℹ️ Ignoring event type:', event.type);
          break;
      }

      console.log('✅ Webhook processed successfully');
      return new Response("ok", { status: 200 });
    } catch (err) {
      console.error("❌ Webhook handler error:", err);
      return new Response("Webhook error", { status: 500 });
    }
  } catch (err) {
    console.error("❌ Global webhook error:", err);
    return new Response(`Global error: ${err.message}`, { status: 400 });
  }
});