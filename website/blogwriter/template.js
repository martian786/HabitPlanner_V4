// HTML template generation
import { esc } from "./utils.js";

export function postHtml({
  title,
  kicker,
  datePretty,
  bodyHtml,
  coverUrl,
  readMins,
}) {
  const minLabel = readMins === 1 ? "min" : "mins";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} - HabitBlock</title>

  <!-- Google Analytics 4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-Y24D5E5VZ7"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('consent', 'default', {
      'analytics_storage': 'denied'
    });
    gtag('config', 'G-Y24D5E5VZ7');
  </script>

  <script src="https://cdn.tailwindcss.com"></script>
  <script src="../config.js"></script>
  <link rel="stylesheet" href="../assets/blog.css">

  <style>
    /* Reset root font-size to 16px to override blog.css scaling */
    html {
      font-size: 16px !important;
    }

    :root {
      --color-rich-black: #03071eff;
      --color-chocolate-cosmos: #370617ff;
      --color-rosewood: #6a040fff;
      --color-penn-red: #9d0208ff;
      --color-engineering-orange: #d00000ff;
      --color-sinopia: #dc2f02ff;
      --color-persimmon: #e85d04ff;
      --color-princeton-orange: #f48c06ff;
      --color-orange-web: #faa307ff;
      --color-selective-yellow: #ffba08ff;
    }

    .bg-gradient-white-yellow {
      background: linear-gradient(to bottom, white, var(--color-selective-yellow));
    }

    .text-rich-black { color: var(--color-rich-black); }
    .text-penn-red { color: var(--color-penn-red); }
    .bg-penn-red { background-color: var(--color-penn-red); }

    .mobile-menu {
      display: none;
    }
    .mobile-menu.show {
      display: block;
    }

    .readtime {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      padding: 2px 8px;
      border: 1px solid rgba(10,10,35,.12);
      border-radius: 999px;
      font-size: 12px;
    }
    .readtime svg {
      width: 14px;
      height: 14px;
    }

    /* Override blog.css to match contact.html header */
    header, header * {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      line-height: 1.5 !important;
      letter-spacing: 0 !important;
      -webkit-font-smoothing: subpixel-antialiased !important;
      -moz-osx-font-smoothing: auto !important;
    }
  </style>
</head>
<body class="bg-gradient-white-yellow text-rich-black font-sans">

  <!-- Header Section -->
  <header class="py-[1.375rem] mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div class="flex justify-between items-center">
      <div class="flex items-center space-x-3">
        <img src="../habitblock-logo.png" alt="HabitBlock Logo" class="h-8 w-8">
        <div class="font-bold text-3xl">HabitBlock</div>
      </div>
      <nav class="hidden md:flex space-x-8 text-lg font-medium">
        <a href="../index.html" class="hover:text-penn-red transition duration-300">Home</a>
        <a href="../features.html" class="hover:text-penn-red transition duration-300">Features</a>
        <a href="../pricing.html" class="hover:text-penn-red transition duration-300">Pricing</a>
        <a href="../about.html" class="hover:text-penn-red transition duration-300">About</a>
        <a href="../contact.html" class="hover:text-penn-red transition duration-300">Contact</a>
        <a href="../blog.html" class="text-penn-red font-semibold">Resources</a>
      </nav>
      <div class="flex items-center space-x-4">
        <a href="#" onclick="window.location.href = window.websiteConfig.getAppUrl()" class="bg-penn-red text-white font-bold py-2 px-6 rounded-full hover:bg-opacity-80 transition duration-300">
          Login
        </a>
        <button class="md:hidden focus:outline-none" onclick="toggleMobileMenu()">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-rich-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Mobile Menu -->
    <div id="mobileMenu" class="mobile-menu mt-4 bg-white rounded-lg shadow-lg p-4">
      <nav class="flex flex-col space-y-4">
        <a href="../index.html" class="hover:text-penn-red transition duration-300">Home</a>
        <a href="../features.html" class="hover:text-penn-red transition duration-300">Features</a>
        <a href="../pricing.html" class="hover:text-penn-red transition duration-300">Pricing</a>
        <a href="../about.html" class="hover:text-penn-red transition duration-300">About</a>
        <a href="../contact.html" class="hover:text-penn-red transition duration-300">Contact</a>
        <a href="../blog.html" class="text-penn-red font-semibold">Resources</a>
        <a href="#" onclick="window.location.href = window.websiteConfig.getAppUrl()" class="bg-penn-red text-white font-bold py-2 px-6 rounded-full text-center hover:bg-opacity-80 transition duration-300">
          Login
        </a>
      </nav>
    </div>
  </header>

  <!-- Article Content -->
  <main class="container">
    <article class="hb-article">
      <header>
        <p class="kicker">${esc(kicker || "Article")}</p>
        <h1>${esc(title)}</h1>
        <p class="meta">${esc(datePretty)} • <span class="readtime">
          <svg viewBox="0 0 24 24" aria-hidden="true" style="display:inline;width:14px;height:14px;vertical-align:middle;"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v6l4 2" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          ${readMins} ${minLabel} read
        </span></p>
      </header>

      ${
        coverUrl
          ? `<figure class="hero fullbleed"><img class="cover" src="${coverUrl}" alt=""></figure>`
          : ""
      }

      ${bodyHtml}

      <hr style="margin: 2rem 0; border: none; border-top: 1px solid #e5e7eb;">

      <p style="margin-top: 2rem;">
        <a href="../blog.html" style="color: var(--accent); font-weight: 500;">← Back to Resources</a>
      </p>
    </article>
  </main>

  <!-- Footer -->
  <footer class="py-16 px-6 text-white text-sm" style="background-color: #370617;">
    <div class="container mx-auto max-w-6xl">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        <!-- Navigation -->
        <div>
          <h3 class="text-lg font-semibold mb-4">Navigation</h3>
          <ul class="space-y-2">
            <li><a href="../index.html" class="hover:text-gray-300 transition duration-300">Home</a></li>
            <li><a href="../features.html" class="hover:text-gray-300 transition duration-300">Features</a></li>
            <li><a href="../pricing.html" class="hover:text-gray-300 transition duration-300">Pricing</a></li>
            <li><a href="../about.html" class="hover:text-gray-300 transition duration-300">About</a></li>
            <li><a href="../contact.html" class="hover:text-gray-300 transition duration-300">Contact</a></li>
            <li><a href="../blog.html" class="hover:text-gray-300 transition duration-300">Resources</a></li>
          </ul>
        </div>

        <!-- Product -->
        <div>
          <h3 class="text-lg font-semibold mb-4">Product</h3>
          <ul class="space-y-2">
            <li><a href="#" onclick="window.location.href = window.websiteConfig.getAppUrl()" class="hover:text-gray-300 transition duration-300">Login</a></li>
            <li><a href="../pricing.html" class="hover:text-gray-300 transition duration-300">Start 7-Day Free Trial</a></li>
          </ul>
        </div>

        <!-- Legal -->
        <div>
          <h3 class="text-lg font-semibold mb-4">Legal</h3>
          <ul class="space-y-2">
            <li><a href="../privacy-policy.html" class="hover:text-gray-300 transition duration-300">Privacy Policy</a></li>
            <li><a href="../terms-of-service.html" class="hover:text-gray-300 transition duration-300">Terms of Service</a></li>
          </ul>
        </div>
      </div>

      <div class="border-t border-gray-600 mt-12 pt-8 text-center">
        <p>&copy; 2025 Brightsun AI Ltd. All rights reserved.</p>
      </div>
    </div>
  </footer>

  <script>
    function toggleMobileMenu() {
      const menu = document.getElementById('mobileMenu');
      menu.classList.toggle('show');
    }

    // Cookie consent functionality
    function showCookieConsent() {
      if (!localStorage.getItem('cookieConsent')) {
        const banner = document.getElementById('cookieConsent');
        if (banner) banner.style.display = 'block';
      }
    }

    function acceptCookies() {
      localStorage.setItem('cookieConsent', 'accepted');
      document.getElementById('cookieConsent').style.display = 'none';
      gtag('consent', 'update', {
        'analytics_storage': 'granted'
      });
    }

    function declineCookies() {
      localStorage.setItem('cookieConsent', 'declined');
      document.getElementById('cookieConsent').style.display = 'none';
      gtag('consent', 'update', {
        'analytics_storage': 'denied'
      });
    }

    window.addEventListener('load', showCookieConsent);
  </script>

  <!-- Cookie Consent Banner -->
  <div id="cookieConsent" class="fixed bottom-0 left-0 right-0 bg-gray-900 text-white p-4 z-50" style="display: none;">
    <div class="container mx-auto flex flex-col sm:flex-row items-center justify-between">
      <p class="text-sm mb-4 sm:mb-0">
        We use cookies to analyze website traffic and optimize your experience.
        <a href="../privacy-policy.html" class="underline hover:text-gray-300">Privacy Policy</a>
      </p>
      <div class="flex gap-3">
        <button onclick="acceptCookies()" class="bg-red-600 hover:bg-red-700 px-4 py-2 rounded text-sm font-medium">
          Accept
        </button>
        <button onclick="declineCookies()" class="border border-gray-400 hover:bg-gray-700 px-4 py-2 rounded text-sm">
          Decline
        </button>
      </div>
    </div>
  </div>

</body>
</html>`;
}
