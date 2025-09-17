# Cloudflare Pages Deployment Guide

## Overview
This project has two separate deployments:
1. **Marketing Site**: Static HTML pages in `/website/` directory
2. **App Site**: React/Vite application in root directory

## Flexible URL Configuration
The marketing website now uses a flexible URL configuration system that automatically detects the deployment environment and adjusts URLs accordingly. This eliminates the need to manually update localhost URLs when deploying.

**Key Features:**
- Automatic environment detection (development, staging, production)
- Dynamic URL generation for app links
- No manual URL updates needed for deployment
- Supports custom domains and subdomains

## Deployment Configuration

### Marketing Site
**Repository**: https://github.com/martian786/HabitPlanner_V4
**Branch**: `feature/paywall`

**Build Settings:**
- Build command: (leave empty)
- Build output directory: `website`
- Root directory: (leave empty)

**Environment Variables:**
- None required (static HTML files)

### App Site
**Repository**: https://github.com/martian786/HabitPlanner_V4
**Branch**: `feature/paywall`

**Build Settings:**
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: (leave empty)
- Node.js version: `18`

**Environment Variables:**
```
VITE_SUPABASE_URL=https://qnkeqmisuynxchlkckvs.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFua2VxbWlzdXlueGNobGtja3ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY5OTgzMDYsImV4cCI6MjA3MjU3NDMwNn0.lnQjsIMSdlvWyasEbIp0G39FvAsjEsP6rd6OVLq6qFw
VITE_RECAPTCHA_SITE_KEY=6LfPOsorAAAAAHIgCh4orq7QaHYAmrz37ySBXhah
STRIPE_SECRET_KEY=sk_test_51S3udPA34RVghX8xcfZKjsnixajO4hyvX6C9gbhAzTMnOHUTEzECb9M42TVz5yK5p8zDrP93heomf9AgRpo4kDUK00WfTTnOg4
STRIPE_WEBHOOK_SECRET=whsec_NdSzcqGhmc7XyGXGZGDPJTFCGmg8tu2U
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFua2VxbWlzdXlueGNobGtja3ZzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njk5ODMwNiwiZXhwIjoyMDcyNTc0MzA2fQ.dKIKn9Nomt8bB9-j4Ya4jKk5TxJT2s_DW7UfO5Dia-k
SITE_URL=https://app.habitblock.com
```

**Important**: Add `SITE_URL` environment variable for the app deployment to ensure Supabase functions redirect correctly after payment.

## Deployment Steps

### Step 1: Create Marketing Site
1. Go to Cloudflare Pages dashboard
2. Click "Create a project"
3. Connect to GitHub and select `martian786/HabitPlanner_V4`
4. Choose branch: `feature/paywall`
5. Configure build settings as specified above
6. Deploy

### Step 2: Create App Site
1. Create another project in Cloudflare Pages
2. Connect to same GitHub repo `martian786/HabitPlanner_V4`
3. Choose branch: `feature/paywall`
4. Configure build settings as specified above
5. Add all environment variables in Cloudflare Pages settings
6. Deploy

## Custom Domains
This project is configured for the following domains:
- Marketing site: `habitblock.com`, `www.habitblock.com`
- App site: `app.habitblock.com`

## Pre-deployment Configuration

### Marketing Site URL Configuration
Before deploying the marketing site, update `/website/config.js`:

1. **Set Production Domains**:
   ```javascript
   isProductionDomain(hostname) {
       const productionDomains = [
           'habitblock.com',
           'www.habitblock.com'
       ];
       return productionDomains.includes(hostname);
   }
   ```

2. **App URL is pre-configured** for `app.habitblock.com`:
   ```javascript
   getProductionAppUrl() {
       const protocol = window.location.protocol;
       return `${protocol}//app.habitblock.com`;
   }
   ```

3. **Set Production API URL**:
   ```javascript
   getProductionApiUrl() {
       return 'https://qnkeqmisuynxchlkckvs.supabase.co/functions/v1';
   }
   ```

## Production Environment Variables
Make sure to update environment variables for production:
- Use production Supabase URL and keys
- Use production Stripe keys
- Use production reCAPTCHA keys
- Set `SITE_URL` to your actual app domain

## Troubleshooting URL Configuration

### Links Still Point to Localhost
1. Check browser console for JavaScript errors
2. Verify `config.js` is loaded properly
3. Test with: `console.log(window.websiteConfig.getAppUrl())`

### Environment Not Detected Correctly
1. Check domain in `isProductionDomain()` function
2. Verify hostname detection with: `console.log(window.location.hostname)`
3. Update domain list if using custom domain

## Automatic URL Handling
Once configured, the system automatically:
- Detects localhost during development
- Uses production URLs when deployed
- Supports staging/preview URLs
- No manual URL updates needed for future deployments