// Website Configuration
// This file handles environment-based URLs for flexible deployment

class WebsiteConfig {
    constructor() {
        this.config = this.detectEnvironment();
    }

    detectEnvironment() {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        const port = window.location.port;

        // Development environment
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return {
                environment: 'development',
                appUrl: 'http://localhost:5173',
                websiteUrl: `${protocol}//${hostname}${port ? ':' + port : ''}`,
                apiUrl: 'http://localhost:54321/functions/v1'
            };
        }

        // Cloudflare Pages production environment
        // Matches patterns like: your-app.pages.dev or custom domain
        if (hostname.includes('.pages.dev') || this.isProductionDomain(hostname)) {
            return {
                environment: 'production',
                appUrl: this.getProductionAppUrl(),
                websiteUrl: `${protocol}//${hostname}`,
                apiUrl: this.getProductionApiUrl()
            };
        }

        // Fallback to current domain for preview/staging environments
        return {
            environment: 'staging',
            appUrl: `${protocol}//${hostname}`,
            websiteUrl: `${protocol}//${hostname}`,
            apiUrl: this.getProductionApiUrl()
        };
    }

    isProductionDomain(hostname) {
        // Production domains
        const productionDomains = [
            'habitblock.com',
            'www.habitblock.com'
        ];
        return productionDomains.includes(hostname);
    }

    getProductionAppUrl() {
        const protocol = window.location.protocol;

        // App is deployed at app.habitblock.com
        return `${protocol}//app.habitblock.com`;
    }

    getProductionApiUrl() {
        // Set your production Supabase API URL here
        // You should get this from your Supabase project settings
        return 'https://your-project-id.supabase.co/functions/v1';
    }

    getAppUrl(path = '') {
        const baseUrl = this.config.appUrl;
        if (path.startsWith('/') || path.startsWith('?')) {
            return baseUrl + path;
        }
        return path ? `${baseUrl}/${path}` : baseUrl;
    }

    getWebsiteUrl(path = '') {
        const baseUrl = this.config.websiteUrl;
        if (path.startsWith('/')) {
            return baseUrl + path;
        }
        return path ? `${baseUrl}/${path}` : baseUrl;
    }

    getApiUrl(path = '') {
        const baseUrl = this.config.apiUrl;
        if (path.startsWith('/')) {
            return baseUrl + path;
        }
        return path ? `${baseUrl}/${path}` : baseUrl;
    }

    isProduction() {
        return this.config.environment === 'production';
    }

    isDevelopment() {
        return this.config.environment === 'development';
    }

    isStaging() {
        return this.config.environment === 'staging';
    }
}

// Create global instance
window.websiteConfig = new WebsiteConfig();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebsiteConfig;
}