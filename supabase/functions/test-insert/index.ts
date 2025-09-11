import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  console.log('🧪 Testing subscription insert');
  
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  console.log('🔧 Using service role key:', serviceRoleKey ? `${serviceRoleKey.substring(0, 20)}...` : 'MISSING');

  // Test data matching the recent payment
  const testSubscription = {
    user_id: '89352809-c3e3-4370-8c9e-338e1ac9c347',
    stripe_customer_id: 'cus_T2Nd7XGqJ1H4s9',
    stripe_subscription_id: 'sub_1S6IscA34RVghX8xD3lDZxrs',
    price_id: 'price_1S6ApKA34RVghX8xdm7fWO9O',
    status: 'active',
    current_period_end: new Date(1789165334 * 1000).toISOString()
  };

  console.log('📋 Test subscription data:', JSON.stringify(testSubscription, null, 2));

  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        Prefer: "resolution=merge-duplicates",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testSubscription),
    });

    const responseText = await resp.text();
    console.log('📡 Insert response:', resp.status, responseText);

    if (resp.ok) {
      console.log('✅ SUCCESS: Subscription insert worked!');
      
      // Now test the entitlements view
      const entResp = await fetch(`${supabaseUrl}/rest/v1/user_entitlements?user_id=eq.89352809-c3e3-4370-8c9e-338e1ac9c347`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": "application/json",
        },
      });

      const entResponseText = await entResp.text();
      console.log('🎯 Entitlements response:', entResp.status, entResponseText);

      return new Response(JSON.stringify({
        success: true,
        insert: { status: resp.status, response: responseText },
        entitlements: { status: entResp.status, response: entResponseText }
      }, null, 2), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      console.error('❌ Insert failed:', resp.status, responseText);
      return new Response(JSON.stringify({
        success: false,
        error: { status: resp.status, response: responseText }
      }, null, 2), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('❌ Test insert error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }, null, 2), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});