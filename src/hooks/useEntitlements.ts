// hooks/useEntitlements.ts
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export type Entitlements = {
  plan_code: "pro" | "plus";
  max_objectives: number | null;
  has_advanced_analytics: boolean;
  can_copy_weeks: boolean;
  can_export_json: boolean;
  priority_support: boolean;
} | null;

export function useEntitlements(userId?: string) {
  const [ent, setEnt] = useState<Entitlements>(null);
  const [loading, setLoading] = useState(false);

  const fetchEntitlements = async () => {
    if (!userId) return;
    setLoading(true);
    
    console.log('🔍 Fetching entitlements for user:', userId);
    
    try {
      const { data, error } = await supabase
        .from("user_entitlements")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      
      if (error) {
        console.error('❌ Error fetching entitlements:', error);
      } else {
        console.log('✅ Entitlements data:', data);
        setEnt(data as any ?? null);
      }
    } catch (err) {
      console.error('❌ Exception fetching entitlements:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntitlements();
  }, [userId]);

  // Poll for entitlements after potential payment completion
  useEffect(() => {
    if (!userId) return;
    
    // Check if we just came back from a payment (URL contains stripe session)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('session_id') || localStorage.getItem('recent_payment')) {
      console.log('🔄 Recent payment detected, polling for entitlements...');
      
      // Set flag to prevent multiple polls
      localStorage.setItem('recent_payment', 'true');
      
      // Poll every 2 seconds for up to 30 seconds
      let pollCount = 0;
      const maxPolls = 15;
      
      const interval = setInterval(async () => {
        pollCount++;
        console.log(`🔄 Polling attempt ${pollCount}/${maxPolls}...`);
        
        await fetchEntitlements();
        
        if (ent || pollCount >= maxPolls) {
          console.log('🛑 Stopping poll:', ent ? 'entitlements found' : 'max polls reached');
          clearInterval(interval);
          localStorage.removeItem('recent_payment');
          
          // Clean up URL parameters
          const url = new URL(window.location.href);
          if (url.searchParams.has('payment') || url.searchParams.has('session_id')) {
            url.searchParams.delete('payment');
            url.searchParams.delete('session_id');
            window.history.replaceState(null, '', url.toString());
          }
        }
      }, 2000);
      
      return () => {
        clearInterval(interval);
        localStorage.removeItem('recent_payment');
      };
    }
  }, [userId, ent]);

  return { entitlements: ent, loading, refresh: fetchEntitlements };
}
