import { supabase } from "./supabase";

export async function startCheckout(priceId: string) {
  console.log('🚀 Starting checkout process with priceId:', priceId);
  
  // Ensure we have an authenticated session before invoking the function
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    console.error('❌ No authenticated session found');
    throw new Error("Please sign in to start checkout.");
  }
  
  console.log('✅ User authenticated:', sessionData.session.user.email);

  console.log('📞 Invoking create-checkout function...');
  const { data, error } = await supabase.functions.invoke("create-checkout", {
    body: { priceId },
  });
  
  if (error) {
    console.error('❌ Function invocation error:', error);
    throw error;
  }
  
  console.log('✅ Function response:', data);
  
  if (!data?.url) {
    console.error('❌ No checkout URL in response:', data);
    throw new Error('No checkout URL returned from server');
  }
  
  console.log('🔄 Redirecting to Stripe checkout:', data.url);
  window.location.href = data.url; // Stripe hosted checkout
}
