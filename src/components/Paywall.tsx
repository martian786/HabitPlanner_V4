import { useEffect, useMemo, useRef, useState } from "react";
import { startCheckout } from "../lib/stripe";
import { supabase } from "../lib/supabase";

export default function Paywall() {
  const [planPrices, setPlanPrices] = useState<{ pro?: string; plus?: string }>({});
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState<boolean>(false);
  const autoStartedRef = useRef<boolean>(false);

  // Highlight and preselect plan from marketing site (?plan=pro|plus)
  const urlParams = new URLSearchParams(window.location.search);
  const urlPlan = urlParams.get('plan');
  // Persist selection across redirects (e.g., email verification)
  if (urlPlan) {
    try { localStorage.setItem('selected_plan', urlPlan); } catch {}
  }
  const selectedPlan = urlPlan || (() => {
    try { return localStorage.getItem('selected_plan'); } catch { return null; }
  })();
  const selectedPriceId = useMemo(() => {
    if (selectedPlan === 'plus') return planPrices.plus ?? null;
    if (selectedPlan === 'pro') return planPrices.pro ?? null;
    return null;
  }, [selectedPlan, planPrices]);

  // Detect and clean auto_checkout flag from URL (fallback when localStorage not available)
  useEffect(() => {
    const url = new URL(window.location.href);
    const flag = url.searchParams.get('auto_checkout');
    if (flag === '1') {
      try { localStorage.setItem('auto_checkout', '1'); } catch {}
      // Clean it from the URL for aesthetics
      url.searchParams.delete('auto_checkout');
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let authSub: { subscription: { unsubscribe: () => void } } | null = null;
    (async () => {
      // Check auth session and keep it updated to avoid timing errors after email verification
      const { data: sessionData } = await supabase.auth.getSession();
      if (mounted) setHasSession(!!sessionData.session);
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (mounted) setHasSession(!!session);
      });
      authSub = sub;

      setLoadingPlans(true);
      setPlansError(null);
      const { data: plansData, error } = await supabase
        .from("plans")
        .select("price_id, code")
        .in("code", ["pro", "plus"]);
      if (!mounted) return;
      if (error) {
        console.error("❌ Failed to load plans:", error);
        setPlansError("Failed to load plans. Please retry.");
      } else {
        console.log("✅ Plans loaded from database:", plansData);
        const map: { pro?: string; plus?: string } = {};
        plansData?.forEach((r: any) => {
          if (r.code === "pro") map.pro = r.price_id;
          if (r.code === "plus") map.plus = r.price_id;
        });
        console.log("📋 Plan price mapping:", map);
        setPlanPrices(map);
      }
      setLoadingPlans(false);
    })();
    return () => { 
      mounted = false; 
      try { authSub?.subscription.unsubscribe(); } catch {}
    };
  }, []);

  // Auto-start checkout after verification if flagged
  useEffect(() => {
    if (!hasSession) return;
    if (!selectedPriceId) return;
    if (loadingPlans) return;
    if (autoStartedRef.current) return;
    try {
      const flag = localStorage.getItem('auto_checkout');
      if (flag === '1') {
        autoStartedRef.current = true;
        localStorage.removeItem('auto_checkout');
        handleCheckout(selectedPriceId);
      }
    } catch {}
  }, [hasSession, selectedPriceId, loadingPlans]);
  const handleCheckout = async (priceId: string) => {
    console.log('Starting checkout for price:', priceId);
    try {
      await startCheckout(priceId);
    } catch (error) {
      console.error('Checkout failed:', error);
      alert('Checkout failed: ' + (error as Error).message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`p-6 border rounded-xl shadow bg-white ${selectedPlan === 'pro' ? 'ring-2 ring-pink-500' : ''}`}>
          <h2 className="text-xl font-bold mb-2">Habit Pro</h2>
          <p className="text-slate-600 mb-4">Perfect for getting started.</p>
          <ul className="text-sm mb-4 space-y-1">
            <li>✔ Up to 5 objectives</li>
            <li>✔ Weekly analytics</li>
            <li>✔ Mobile & desktop access</li>
          </ul>
          <button
            onClick={() => planPrices.pro && handleCheckout(planPrices.pro)}
            disabled={!planPrices.pro || loadingPlans || !hasSession}
            className={`w-full px-4 py-2 rounded-lg text-white ${(!planPrices.pro || loadingPlans || !hasSession) ? 'bg-slate-400 cursor-not-allowed' : 'bg-slate-900 hover:bg-slate-800'}`}
          >
            {loadingPlans ? 'Loading...' : (!hasSession ? 'Sign in to continue' : '£99/year – Start Free Trial')}
          </button>
        </div>

        <div className={`p-6 border rounded-xl shadow bg-white ${selectedPlan === 'plus' ? 'ring-2 ring-pink-500' : ''}`}>
          <h2 className="text-xl font-bold mb-2">Habit Plus</h2>
          <p className="text-slate-600 mb-4">Serious productivity features.</p>
          <ul className="text-sm mb-4 space-y-1">
            <li>✔ Unlimited objectives</li>
            <li>✔ Advanced analytics & charts</li>
            <li>✔ Copy weeks & templates</li>
            <li>✔ JSON export</li>
            <li>✔ Priority support</li>
          </ul>
          <button
            onClick={() => planPrices.plus && handleCheckout(planPrices.plus)}
            disabled={!planPrices.plus || loadingPlans || !hasSession}
            className={`w-full px-4 py-2 rounded-lg text-white ${(!planPrices.plus || loadingPlans || !hasSession) ? 'bg-red-300 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {loadingPlans ? 'Loading...' : (!hasSession ? 'Sign in to continue' : '£149/year – Start Free Trial')}
          </button>
        </div>

        {selectedPriceId && (
          <div className="md:col-span-2 text-center text-sm text-slate-600">
            Selected plan: <span className="font-semibold">{selectedPlan}</span>
            <button
              onClick={() => handleCheckout(selectedPriceId)}
              disabled={!hasSession}
              className={`ml-3 inline-flex items-center px-3 py-1.5 rounded-md text-white ${!hasSession ? 'bg-slate-400 cursor-not-allowed' : 'bg-slate-900 hover:bg-slate-800'}`}
            >
              {hasSession ? `Continue with ${selectedPlan}` : 'Sign in to continue'}
            </button>
          </div>
        )}
        {plansError && (
          <div className="md:col-span-2 text-center text-sm text-red-600">
            {plansError}
          </div>
        )}
      </div>
    </div>
  );
}
