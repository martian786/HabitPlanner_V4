import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { token, action = 'signup' } = await req.json()

    console.log('Received request:', { token: token ? 'present' : 'missing', action })

    if (!token) {
      console.log('ERROR: No token provided')
      return new Response(
        JSON.stringify({ error: 'reCAPTCHA token is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const secretKey = Deno.env.get('RECAPTCHA_SECRET_KEY')
    console.log('Secret key configured:', secretKey ? 'yes' : 'no')
    if (!secretKey) {
      console.log('ERROR: No secret key configured')
      return new Response(
        JSON.stringify({ error: 'reCAPTCHA secret key not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Verify reCAPTCHA token with Google
    const verifyUrl = 'https://www.google.com/recaptcha/api/siteverify'
    const verifyData = new URLSearchParams({
      secret: secretKey,
      response: token,
    })

    const verifyResponse = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: verifyData,
    })

    const verifyResult = await verifyResponse.json()
    console.log('Google reCAPTCHA response:', verifyResult)

    // Check if verification was successful
    if (!verifyResult.success) {
      console.log('ERROR: reCAPTCHA verification failed:', verifyResult)
      return new Response(
        JSON.stringify({
          error: 'reCAPTCHA verification failed',
          details: verifyResult['error-codes'] || [],
          debugInfo: verifyResult
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Check score for v3 (0.0 = bot, 1.0 = human)
    const score = verifyResult.score || 0
    const minScore = 0.5 // Adjust threshold as needed

    if (score < minScore) {
      return new Response(
        JSON.stringify({
          error: 'Suspicious activity detected',
          score: score
        }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Verification successful
    return new Response(
      JSON.stringify({
        success: true,
        score: score,
        action: verifyResult.action,
        challenge_ts: verifyResult.challenge_ts,
        hostname: verifyResult.hostname
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})