// Google Analytics Configuration
// Replace 'GA_MEASUREMENT_ID' with your actual Google Analytics 4 Measurement ID
// Example: 'G-XXXXXXXXXX'

const ANALYTICS_CONFIG = {
  GA_MEASUREMENT_ID: 'G-Y24D5E5VZ7', // Your actual GA4 ID

  // Event categories
  EVENTS: {
    CONVERSION: 'conversion',
    ENGAGEMENT: 'engagement',
    NAVIGATION: 'navigation'
  },

  // Conversion event names
  CONVERSIONS: {
    TRIAL_START: 'trial_start',
    LOGIN_ATTEMPT: 'login_attempt',
    SIGN_UP: 'sign_up',
    PURCHASE: 'purchase'
  }
};

// Initialize GA4 if measurement ID is set
if (ANALYTICS_CONFIG.GA_MEASUREMENT_ID !== 'GA_MEASUREMENT_ID') {
  // Replace placeholder in script tags
  document.addEventListener('DOMContentLoaded', function() {
    const scripts = document.querySelectorAll('script[src*="GA_MEASUREMENT_ID"]');
    scripts.forEach(script => {
      script.src = script.src.replace('GA_MEASUREMENT_ID', ANALYTICS_CONFIG.GA_MEASUREMENT_ID);
    });
  });
}