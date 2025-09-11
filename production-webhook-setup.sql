-- Production-ready webhook processing setup

-- 1. Webhook events tracking table (idempotency)
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_duration_ms INTEGER,
  user_id UUID REFERENCES auth.users(id),
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_events_stripe_event_id_idx ON public.webhook_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS webhook_events_processed_at_idx ON public.webhook_events(processed_at);
CREATE INDEX IF NOT EXISTS webhook_events_user_id_idx ON public.webhook_events(user_id);

-- 2. Production-grade subscription upsert function
CREATE OR REPLACE FUNCTION public.process_subscription_webhook(
  stripe_event_id TEXT,
  event_type TEXT,
  user_id UUID,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  price_id TEXT,
  status TEXT,
  current_period_end TIMESTAMPTZ
) RETURNS JSONB AS $$
DECLARE
  result JSONB;
  start_time TIMESTAMPTZ;
  processing_duration INTEGER;
BEGIN
  start_time := NOW();
  
  -- Idempotency check
  IF EXISTS (SELECT 1 FROM public.webhook_events WHERE stripe_event_id = $1) THEN
    result := jsonb_build_object(
      'success', true,
      'message', 'Event already processed',
      'duplicate', true
    );
    RETURN result;
  END IF;
  
  -- Atomic transaction: insert/update subscription + log event
  BEGIN
    -- Upsert subscription
    INSERT INTO public.subscriptions (
      user_id, 
      stripe_customer_id, 
      stripe_subscription_id, 
      price_id, 
      status, 
      current_period_end
    ) VALUES (
      $3, $4, $5, $6, $7, $8
    )
    ON CONFLICT (stripe_subscription_id) 
    DO UPDATE SET
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      updated_at = NOW()
    WHERE subscriptions.stripe_subscription_id = $5;
    
    -- Calculate processing time
    processing_duration := EXTRACT(EPOCH FROM (NOW() - start_time)) * 1000;
    
    -- Log successful event
    INSERT INTO public.webhook_events (
      stripe_event_id,
      event_type,
      processed_at,
      processing_duration_ms,
      user_id,
      success
    ) VALUES (
      $1, $2, NOW(), processing_duration, $3, TRUE
    );
    
    result := jsonb_build_object(
      'success', true,
      'message', 'Subscription processed successfully',
      'processing_duration_ms', processing_duration,
      'duplicate', false
    );
    
  EXCEPTION WHEN OTHERS THEN
    -- Log failed event
    processing_duration := EXTRACT(EPOCH FROM (NOW() - start_time)) * 1000;
    
    INSERT INTO public.webhook_events (
      stripe_event_id,
      event_type,
      processed_at,
      processing_duration_ms,
      user_id,
      success,
      error_message
    ) VALUES (
      $1, $2, NOW(), processing_duration, $3, FALSE, SQLERRM
    );
    
    result := jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'processing_duration_ms', processing_duration
    );
  END;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.process_subscription_webhook TO anon, authenticated;

-- 3. Monitoring views
CREATE OR REPLACE VIEW public.webhook_stats AS
SELECT 
  event_type,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE success = true) as successful_events,
  COUNT(*) FILTER (WHERE success = false) as failed_events,
  ROUND(AVG(processing_duration_ms), 2) as avg_processing_ms,
  MAX(processed_at) as last_processed
FROM public.webhook_events 
GROUP BY event_type
ORDER BY total_events DESC;

GRANT SELECT ON public.webhook_stats TO anon, authenticated;