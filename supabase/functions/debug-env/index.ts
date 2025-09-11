import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  console.log('🔧 Environment Debug');
  
  const envInfo = {
    SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? `${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.substring(0, 20)}...` : 'MISSING',
    SERVICE_ROLE_KEY: Deno.env.get("SERVICE_ROLE_KEY") ? `${Deno.env.get("SERVICE_ROLE_KEY")?.substring(0, 20)}...` : 'MISSING',
    STRIPE_WEBHOOK_SECRET: Deno.env.get("STRIPE_WEBHOOK_SECRET") ? `${Deno.env.get("STRIPE_WEBHOOK_SECRET")?.substring(0, 10)}...` : 'MISSING',
    STRIPE_SECRET_KEY: Deno.env.get("STRIPE_SECRET_KEY") ? `${Deno.env.get("STRIPE_SECRET_KEY")?.substring(0, 10)}...` : 'MISSING'
  };

  console.log('📋 Environment variables:', envInfo);

  // Test a simple database connection
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/subscriptions?limit=1`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
    });

    const responseText = await resp.text();
    console.log('🔗 Database connection test:', resp.status, responseText);

    return new Response(JSON.stringify({
      env: envInfo,
      dbTest: {
        status: resp.status,
        response: responseText.substring(0, 200)
      }
    }, null, 2), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('❌ Database connection error:', error);
    return new Response(JSON.stringify({
      env: envInfo,
      error: error.message
    }, null, 2), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});