// Debug webhook to test basic connectivity
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  console.log('🔧 DEBUG WEBHOOK CALLED');
  
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  console.log('🔍 Environment check:');
  console.log('- SUPABASE_URL exists:', !!supabaseUrl);
  console.log('- SERVICE_ROLE_KEY exists:', !!serviceRoleKey);
  console.log('- SUPABASE_URL value:', supabaseUrl);
  console.log('- SERVICE_ROLE_KEY prefix:', serviceRoleKey?.substring(0, 20) + '...');
  
  // Test 1: Basic API call to plans table
  try {
    console.log('📋 Testing plans table access...');
    const plansResp = await fetch(`${supabaseUrl}/rest/v1/plans`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
    });
    
    console.log('Plans API Status:', plansResp.status);
    const plansText = await plansResp.text();
    console.log('Plans API Response:', plansText);
    
  } catch (err) {
    console.error('❌ Plans API Error:', err);
  }
  
  // Test 2: Try to read subscriptions table
  try {
    console.log('🔍 Testing subscriptions table access...');
    const subsResp = await fetch(`${supabaseUrl}/rest/v1/subscriptions?limit=1`, {
      method: "GET", 
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
    });
    
    console.log('Subscriptions API Status:', subsResp.status);
    const subsText = await subsResp.text();
    console.log('Subscriptions API Response:', subsText);
    
  } catch (err) {
    console.error('❌ Subscriptions API Error:', err);
  }
  
  return new Response('DEBUG COMPLETE - CHECK LOGS', { status: 200 });
});