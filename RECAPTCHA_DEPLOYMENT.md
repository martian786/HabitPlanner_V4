# reCAPTCHA v3 Production Deployment Guide

## Overview
This guide covers deploying the reCAPTCHA v3 anti-bot protection system to production.

## Prerequisites
- Supabase project deployed to production
- Production domain configured
- Access to Google reCAPTCHA Admin Console

## Production Setup Steps

### 1. Configure Production reCAPTCHA Keys

#### A. Update reCAPTCHA Domain List
1. Go to [Google reCAPTCHA Admin Console](https://www.google.com/recaptcha/admin)
2. Select your reCAPTCHA site
3. Add your production domain(s) to the domain list:
   ```
   yourdomain.com
   www.yourdomain.com
   ```
4. Remove `localhost` from production keys (keep separate keys for dev/prod)

#### B. Create Production Environment Variables
Create/update your production `.env` file:
```bash
# Production reCAPTCHA Keys
VITE_RECAPTCHA_SITE_KEY=your_production_site_key_here
# Note: Secret key goes to Supabase, not in .env
```

### 2. Deploy Supabase Edge Function

#### A. Deploy the Function
```bash
# Deploy the reCAPTCHA verification function
supabase functions deploy verify-recaptcha --project-ref YOUR_PROD_PROJECT_REF
```

#### B. Set Production Secret Key
```bash
# Set the reCAPTCHA secret key in Supabase
supabase secrets set RECAPTCHA_SECRET_KEY=your_production_secret_key_here --project-ref YOUR_PROD_PROJECT_REF
```

### 3. Update HTML for Production

The HTML file uses environment variable substitution:
```html
<script src="https://www.google.com/recaptcha/api.js?render=%VITE_RECAPTCHA_SITE_KEY%"></script>
```

This will automatically use the correct site key based on your environment.

### 4. Environment-Specific Configuration

#### Development Environment
```bash
# .env.development
VITE_RECAPTCHA_SITE_KEY=6LfnJMorAAAAANau9ARRAU5O2qwTK8Fj3TeIwZ3F
```

#### Production Environment
```bash
# .env.production
VITE_RECAPTCHA_SITE_KEY=your_production_site_key
```

### 5. Deployment Checklist

- [ ] Production reCAPTCHA keys created with correct domains
- [ ] Production site key added to `.env.production`
- [ ] Edge function deployed to production Supabase project
- [ ] Secret key configured in production Supabase secrets
- [ ] Domain list updated in reCAPTCHA console
- [ ] Test signup flow on production domain
- [ ] Verify reCAPTCHA loads without errors
- [ ] Check browser console for warnings

### 6. Testing Production Setup

#### A. Test reCAPTCHA Loading
1. Open browser developer tools
2. Navigate to your production signup page
3. Check for reCAPTCHA script loading without errors
4. Verify no "domain not authorized" messages

#### B. Test Signup Flow
1. Attempt to sign up with a valid email
2. Check that the process completes without Edge Function errors
3. Verify email verification link is received

#### C. Test Bot Protection
The system will automatically block low-scoring requests. Monitor through:
- Supabase Edge Function logs
- reCAPTCHA Admin Console analytics

### 7. Monitoring and Analytics

#### A. Supabase Function Logs
Monitor your Edge Function performance:
```bash
# View recent logs (if available in your Supabase CLI version)
supabase functions logs verify-recaptcha --project-ref YOUR_PROD_PROJECT_REF
```

#### B. reCAPTCHA Analytics
1. Go to [reCAPTCHA Admin Console](https://www.google.com/recaptcha/admin)
2. Select your site
3. View analytics dashboard for:
   - Request volume
   - Score distribution
   - Blocked vs. allowed requests

### 8. Security Best Practices

#### A. Environment Variable Security
- Never commit secret keys to version control
- Use different keys for development and production
- Store secret keys only in Supabase secrets (server-side)

#### B. Score Threshold Tuning
Monitor your analytics and adjust the score threshold in the Edge Function:
```typescript
const minScore = 0.5 // Adjust based on your needs
```

- Higher threshold (0.7+): More restrictive, may block some humans
- Lower threshold (0.3-): Less restrictive, may allow some bots

#### C. Error Handling
The current setup handles failures gracefully. Consider logging failures for monitoring:
```typescript
if (score < minScore) {
  console.log(`Blocked signup attempt with score: ${score}`);
  // Log to your monitoring system
}
```

### 9. Troubleshooting

#### Common Issues:

**"Domain not authorized" error:**
- Check domain is added to reCAPTCHA console
- Verify correct site key is being used
- Ensure no typos in domain names

**Edge Function errors:**
- Verify secret key is set in Supabase
- Check function is deployed to correct project
- Review function logs for specific errors

**reCAPTCHA not loading:**
- Check script tag in HTML
- Verify site key environment variable
- Look for browser console errors

### 10. Maintenance

#### Regular Tasks:
- Monitor reCAPTCHA analytics monthly
- Review and adjust score thresholds as needed
- Keep track of blocked vs. legitimate signups
- Update domain list when adding new subdomains

## File Structure
```
├── index.html                           # reCAPTCHA script tag
├── src/App.tsx                          # Frontend reCAPTCHA integration
├── supabase/functions/verify-recaptcha/ # Edge Function
│   └── index.ts
├── .env.development                     # Dev environment variables
├── .env.production                      # Prod environment variables
└── RECAPTCHA_DEPLOYMENT.md             # This documentation
```

## Support
For issues with this setup, check:
1. Browser developer console for frontend errors
2. Supabase dashboard for Edge Function logs
3. reCAPTCHA Admin Console for verification issues