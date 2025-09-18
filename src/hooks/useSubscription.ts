import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useSubscription(userId?: string) {
  const [sub, setSub] = useState<any>(null);

  useEffect(() => {
    console.log('📋 [DEBUG] useSubscription useEffect triggered for userId:', userId);
    if (!userId) return;
    (async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return;
      if (data && ["active", "trialing"].includes(data.status) && new Date(data.current_period_end) > new Date()) {
        setSub(data);
      } else {
        setSub(null);
      }
    })();
  }, [userId]);

  return sub;
}
