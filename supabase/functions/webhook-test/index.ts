// Simple webhook test endpoint - accepts all requests for debugging
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  console.log('🎯 TEST WEBHOOK CALLED');
  console.log('Method:', req.method);
  console.log('Headers:', Object.fromEntries(req.headers.entries()));
  
  if (req.method === 'POST') {
    try {
      const text = await req.text();
      console.log('Body length:', text.length);
      console.log('Body preview:', text.substring(0, 200));
      
      // Try to parse as JSON
      const data = JSON.parse(text);
      console.log('Event type:', data.type);
      console.log('Event ID:', data.id);
      
      if (data.type === 'customer.subscription.created' || 
          data.type === 'customer.subscription.updated') {
        const sub = data.data.object;
        console.log('Subscription ID:', sub.id);
        console.log('Subscription status:', sub.status);
        console.log('Customer ID:', sub.customer);
        console.log('Metadata:', sub.metadata);
      }
      
    } catch (err) {
      console.error('Error parsing webhook:', err);
    }
  }
  
  return new Response('TEST WEBHOOK OK', { status: 200 });
});