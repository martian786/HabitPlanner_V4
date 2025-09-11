import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function DatabaseSetup() {
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const runSetup = async () => {
    setLoading(true);
    setStatus('🚀 Setting up database...');

    try {
      // Create subscriptions table
      const { error: subError } = await supabase.rpc('run_sql', {
        sql: `
-- Subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON public.subscriptions(user_id);

-- Row Level Security
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users can read own subscription" ON public.subscriptions;
CREATE POLICY "users can read own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);`
      });

      if (subError) throw subError;
      setStatus('✅ Subscriptions table created');

      // Create plans table
      const { error: plansError } = await supabase.rpc('run_sql', {
        sql: `
-- Plans table
CREATE TABLE IF NOT EXISTS public.plans (
  price_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  max_objectives INT,
  has_advanced_analytics BOOLEAN NOT NULL DEFAULT FALSE,
  can_copy_weeks BOOLEAN NOT NULL DEFAULT FALSE,
  can_export_json BOOLEAN NOT NULL DEFAULT FALSE,
  priority_support BOOLEAN NOT NULL DEFAULT FALSE
);

GRANT SELECT ON public.plans TO anon, authenticated;

-- Seed plans data
INSERT INTO public.plans (price_id, code, name, max_objectives, has_advanced_analytics, can_copy_weeks, can_export_json, priority_support)
VALUES
  ('price_1S6ApKA34RVghX8xdm7fWO9O','pro','Habit Pro',5,true,false,false,false),
  ('price_1S6AqCA34RVghX8xnE0e3E7p','plus','Habit Plus',null,true,true,true,true)
ON CONFLICT (price_id) DO UPDATE SET
  code=EXCLUDED.code, name=EXCLUDED.name, max_objectives=EXCLUDED.max_objectives,
  has_advanced_analytics=EXCLUDED.has_advanced_analytics, can_copy_weeks=EXCLUDED.can_copy_weeks,
  can_export_json=EXCLUDED.can_export_json, priority_support=EXCLUDED.priority_support;`
      });

      if (plansError) throw plansError;
      setStatus('✅ Plans table created and seeded');

      // Create entitlements view
      const { error: viewError } = await supabase.rpc('run_sql', {
        sql: `
-- User entitlements view
CREATE OR REPLACE VIEW public.user_entitlements AS
SELECT
  s.user_id,
  s.price_id,
  p.code AS plan_code,
  p.name AS plan_name,
  p.max_objectives,
  p.has_advanced_analytics,
  p.can_copy_weeks,
  p.can_export_json,
  p.priority_support,
  s.status,
  s.current_period_end
FROM public.subscriptions s
JOIN public.plans p ON p.price_id = s.price_id
WHERE s.status IN ('active','trialing') AND s.current_period_end > now();

GRANT SELECT ON public.user_entitlements TO anon, authenticated;`
      });

      if (viewError) throw viewError;
      setStatus('✅ Database setup complete! All tables, views, and data created.');

    } catch (error: any) {
      console.error('Database setup error:', error);
      setStatus(`❌ Setup failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const testQuery = async () => {
    setStatus('🔍 Testing database...');
    
    try {
      const { data: plans, error: plansError } = await supabase
        .from('plans')
        .select('*');
      
      if (plansError) throw plansError;
      
      const { data: subs, error: subsError } = await supabase
        .from('subscriptions')
        .select('*');
        
      if (subsError) throw subsError;

      setStatus(`✅ Test complete - Found ${plans?.length || 0} plans, ${subs?.length || 0} subscriptions`);
      console.log('Plans:', plans);
      console.log('Subscriptions:', subs);
      
    } catch (error: any) {
      setStatus(`❌ Test failed: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">🔧 Database Setup Tool</h1>
        
        <div className="bg-white rounded-lg p-6 shadow mb-6">
          <h2 className="text-xl font-semibold mb-4">Setup Database Tables</h2>
          <p className="text-gray-600 mb-4">
            This will create the subscriptions table, plans table, and user_entitlements view.
          </p>
          
          <button
            onClick={runSetup}
            disabled={loading}
            className={`w-full px-4 py-2 rounded-lg text-white font-medium ${
              loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {loading ? 'Setting up...' : 'Run Database Setup'}
          </button>
        </div>

        <div className="bg-white rounded-lg p-6 shadow mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Database</h2>
          <p className="text-gray-600 mb-4">
            Check if tables exist and have data.
          </p>
          
          <button
            onClick={testQuery}
            className="w-full px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium"
          >
            Test Database
          </button>
        </div>

        {status && (
          <div className="bg-black text-green-400 rounded-lg p-4 font-mono text-sm">
            {status}
          </div>
        )}

        <div className="mt-6 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
          <h3 className="font-semibold text-yellow-800 mb-2">⚠️ Next Steps</h3>
          <ol className="text-yellow-700 space-y-1 text-sm">
            <li>1. Run database setup above</li>
            <li>2. Configure Stripe webhook at: <code className="bg-yellow-100 px-1 rounded">https://qnkeqmisuynxchlkckvs.supabase.co/functions/v1/stripe-webhook</code></li>
            <li>3. Test payment flow again</li>
          </ol>
        </div>
      </div>
    </div>
  );
}