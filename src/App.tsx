import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { useDataService } from "./hooks/useDataService";
import { DataService, MAX_OBJECTIVE_NAME_LENGTH } from "./lib/dataService";
import { useEntitlements } from "./hooks/useEntitlements";
import { useSubscription } from "./hooks/useSubscription";
import Paywall from "./components/Paywall";
import MFAChallenge from "./components/MFAChallenge";
import AccountSettings from "./components/AccountSettings";
import habitblockLogo from "./assets/habitblock-logo.png";

/*************************************************
 * Habitblock + Supabase (Auth + DB)
 *************************************************/

/********************** Utilities **********************/
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toISODate = (d: Date) => {
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
};
const fromISODate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function getWeekStart(date: Date, weekStartsOn: "Monday" | "Sunday" = "Monday") {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun - 6 Sat
  const startIndex = weekStartsOn === "Sunday" ? 0 : 1; // Monday=1
  const diff = (day - startIndex + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatTimeLabel(totalMinutes: number) {
  let h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12; // 12 AM
  if (h > 12) h -= 12; // 13 -> 1 PM
  return { time: `${h}:${pad(m)}`, period: ampm };
}

function timeStrToMinutes(str: string) {
  const [hh, mm] = str.split(":").map(Number);
  return hh * 60 + mm;
}

function minutesToTimeStr(min: number) {
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return `${pad(hh)}:${pad(mm)}`;
}

// uid function removed - using database-generated UUIDs

// Note: localStorage not used for authenticated users (database-only)

type AnyObj = Record<string, unknown>;

/******************** Defaults ************************/ 
// Note: Default settings moved to dataService.ts UserPreferences interface

// DEFAULT_OBJECTIVES moved to dataService for seeding new users

// Using Objective and UserPreferences from dataService
type Entry = { id: string; completed: boolean };

/******************** Stats helpers ********************/
function computeWeeklyStats(
  objectives: {id:string;name:string;color:string}[],
  daysISO: string[],
  schedule: AnyObj,
  slotMinutes: number
) {
  const totals: Record<string, { total: number; completed: number; name: string; color: string }> = Object.fromEntries(
    objectives.map(o => [o.id, { total: 0, completed: 0, name: o.name, color: o.color }])
  );
  for (const iso of daysISO) {
    const dayMap = schedule[iso];
    if (!dayMap) continue;
    for (const k in dayMap) {
      const raw = dayMap[k];
      const entry: Entry = typeof raw === 'string' ? { id: raw, completed: false } : raw as Entry;
      if (!entry) continue;
      const rec = totals[entry.id];
      if (!rec) continue;
      rec.total += 1;
      if (entry.completed) rec.completed += 1;
    }
  }
  return objectives.map(o => {
    const rec = totals[o.id] || { total: 0, completed: 0 };
    const hours = (rec.total * slotMinutes) / 60;
    const percent = rec.total ? (rec.completed / rec.total) * 100 : 0;
    return { id: o.id, name: o.name, color: o.color, slots: (totals[o.id]?.total ?? 0), completedSlots: (totals[o.id]?.completed ?? 0), hours, percent };
  });
}

function countWeekBlocks(schedule: AnyObj, daysISO: string[]) {
  let c = 0;
  console.log("Counting blocks for days:", daysISO);
  for (const iso of daysISO) {
    const dm = schedule[iso] || {};
    const dayCount = Object.keys(dm).length;
    console.log(`Day ${iso}: ${dayCount} blocks`, dm);
    c += dayCount;
  }
  console.log("Total blocks counted:", c);
  return c;
}

function buildCopyWeekPatch(schedule: AnyObj, srcDays: string[], destDays: string[], carryTicks = true) {
  const overwrite: AnyObj = {};
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const srcMap = schedule[srcDays[i]] || {};
    const newMap: AnyObj = {};
    for (const k in srcMap) {
      const e: Entry = typeof srcMap[k] === 'string' ? { id: srcMap[k] as string, completed: false } : srcMap[k] as Entry;
      if (!e) continue;
      newMap[k] = { id: e.id, completed: carryTicks ? !!e.completed : false };
    }
    count += Object.keys(newMap).length;
    overwrite[destDays[i]] = newMap;
  }
  return { overwrite, count };
}

/********************* Auth Gate **********************/
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsMFAChallenge, setNeedsMFAChallenge] = useState(false);
  const [showPasswordResetModal, setShowPasswordResetModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // Password reset handler
  const handlePasswordReset = async () => {
    if (!newPassword.trim()) {
      alert('Please enter a new password');
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      alert('Password updated successfully!');
      setShowPasswordResetModal(false);
      setNewPassword('');
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'Failed to update password');
    }
  };

  // Session validation and token refresh
  const validateSession = async (currentSession: Session | null) => {
    if (!currentSession) return null;
    
    try {
      // Check if token is expired (with 5 minute buffer)
      const expiresAt = currentSession.expires_at;
      const now = Math.floor(Date.now() / 1000);
      const bufferSeconds = 300; // 5 minutes
      
      if (expiresAt && (expiresAt - bufferSeconds) <= now) {
        console.log('Session expired, attempting refresh...');
        const { data, error } = await supabase.auth.refreshSession();
        if (error) {
          console.error('Session refresh failed:', error);
          setAuthError('Your session has expired. Please sign in again.');
          return null;
        }
        return data.session;
      }
      
      return currentSession;
    } catch (error) {
      console.error('Session validation error:', error);
      setAuthError('Authentication error. Please sign in again.');
      return null;
    }
  };

  useEffect(() => {
    let mounted = true;
    
    const initializeAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error('Error getting session:', error);
          setAuthError('Failed to load authentication state.');
          return;
        }
        
        const validatedSession = await validateSession(data.session);
        if (mounted) {
          setSession(validatedSession);
          setAuthError(null);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        if (mounted) {
          setAuthError('Failed to initialize authentication.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, s) => {
      console.log('Auth state change:', event);

      // Handle password recovery with modal
      if (event === 'PASSWORD_RECOVERY') {
        setShowPasswordResetModal(true);
        return;
      }

      // Clear any previous errors
      setAuthError(null);
      
      // Clear data when user changes (security measure) 
      if (s?.user?.id !== session?.user?.id && session?.user?.id) {
        console.log("User changed, clearing all data");
        // Only clear on actual user change, not on initial login
        localStorage.clear();
      }
      
      // Validate the new session
      const validatedSession = await validateSession(s);
      if (mounted) {
        setSession(validatedSession);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [session?.user?.id]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Authentication error state
  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg text-center">
          <div className="text-red-500 mb-4">⚠️</div>
          <h2 className="text-lg font-semibold mb-2">Authentication Error</h2>
          <p className="text-slate-600 mb-4">{authError}</p>
          <button
            onClick={() => {
              setAuthError(null);
              setLoading(true);
              window.location.reload();
            }}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!session) return <AuthScreen setNeedsMFAChallenge={setNeedsMFAChallenge} />;

  return (
    <>
      <AuthenticatedApp
        session={session}
        setNeedsMFAChallenge={setNeedsMFAChallenge}
      />

      {/* MFA Challenge Modal */}
      {needsMFAChallenge && (
        <MFAChallenge
          onSuccess={() => setNeedsMFAChallenge(false)}
          onCancel={() => {
            // User cancelled MFA, sign them out for security
            sessionStorage.removeItem('mfa_completed');
            supabase.auth.signOut();
          }}
        />
      )}

      {/* Password Reset Modal */}
      {showPasswordResetModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full">
            <h2 className="text-lg font-semibold mb-4">Reset Password</h2>

            <div className="space-y-4">
              <input
                type="password"
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />

              <div className="flex gap-3">
                <button
                  onClick={handlePasswordReset}
                  disabled={!newPassword.trim()}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Update Password
                </button>
                <button
                  onClick={() => {
                    setShowPasswordResetModal(false);
                    setNewPassword('');
                  }}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AuthScreen({ setNeedsMFAChallenge }: { setNeedsMFAChallenge: (value: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Default to signup if user came from marketing with plan, signin if explicit login
  const urlParams = new URLSearchParams(window.location.search);
  const defaultIsSignUp = urlParams.has('plan') ? true : false;
  const [isSignUp, setIsSignUp] = useState(defaultIsSignUp);
  const [loading, setLoading] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  async function signInWithGoogle() {
    // Preserve current path and query (e.g., ?plan=pro) through OAuth redirect
    const url = new URL(window.location.href);
    const hasPlan = url.searchParams.has('plan');
    if (hasPlan) {
      // Set a durable flag in both localStorage and URL for cross-tab/device
      try { localStorage.setItem('auto_checkout', '1'); } catch { /* ignore localStorage errors */ }
      url.searchParams.set('auto_checkout', '1');
    }
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { 
        redirectTo: url.toString(),
        queryParams: { prompt: 'select_account' }
      },
    });
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      alert('Please enter your email address first');
      return;
    }

    setIsResettingPassword(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}`
      });

      if (error) throw error;
      alert('Password reset email sent! Check your email for instructions.');
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'Failed to send reset email');
    }
    setIsResettingPassword(false);
  }

  async function handleEmailAuth() {
    setLoading(true);
    try {
      if (isSignUp) {
        // Validate consent before proceeding
        if (!privacyAccepted || !termsAccepted) {
          alert('You must accept both the Privacy Policy and Terms of Service to sign up.');
          setLoading(false);
          return;
        }
        // Load and execute reCAPTCHA v3 before signup
        const recaptchaToken = await new Promise<string>((resolve, reject) => {
          // Load reCAPTCHA script dynamically if not already loaded
          if (typeof window.grecaptcha === 'undefined') {
            const script = document.createElement('script');
            script.src = `https://www.google.com/recaptcha/api.js?render=${import.meta.env.VITE_RECAPTCHA_SITE_KEY}`;
            script.onload = () => {
              window.grecaptcha.ready(() => {
                window.grecaptcha.execute(import.meta.env.VITE_RECAPTCHA_SITE_KEY, { action: 'signup' })
                  .then(resolve)
                  .catch(reject);
              });
            };
            script.onerror = () => reject(new Error('Failed to load reCAPTCHA'));
            document.head.appendChild(script);
          } else {
            window.grecaptcha.ready(() => {
              window.grecaptcha.execute(import.meta.env.VITE_RECAPTCHA_SITE_KEY, { action: 'signup' })
                .then(resolve)
                .catch(reject);
            });
          }
        });

        // Verify reCAPTCHA with our edge function
        const verifyResponse = await supabase.functions.invoke('verify-recaptcha', {
          body: { token: recaptchaToken, action: 'signup' }
        });

        if (verifyResponse.error) {
          throw new Error(verifyResponse.error.message || 'reCAPTCHA verification failed');
        }

        if (!verifyResponse.data?.success) {
          throw new Error('Bot detection: Please try again');
        }

        // Preserve current URL (including ?plan=...) and add auto_checkout flag to the verification link
        const url = new URL(window.location.href);
        if (url.searchParams.has('plan')) {
          try { localStorage.setItem('auto_checkout', '1'); } catch { /* ignore localStorage errors */ }
          url.searchParams.set('auto_checkout', '1');
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: url.toString(),
            data: {
              privacy_policy_accepted: privacyAccepted,
              privacy_policy_accepted_at: privacyAccepted ? new Date().toISOString() : null,
              privacy_policy_version: '1.0',
              terms_accepted: termsAccepted,
              terms_accepted_at: termsAccepted ? new Date().toISOString() : null,
              terms_version: '1.0'
            }
          }
        });
        if (error) throw error;
        alert("Check your email for verification link!");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Check if user has MFA enabled after successful password authentication
        if (data.session) {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          if (factors && factors.totp && factors.totp.length > 0) {
            // User has MFA enabled - trigger MFA challenge
            setNeedsMFAChallenge(true);
            return; // Don't complete login yet, wait for MFA
          }
        }
      }
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'Authentication failed');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen grid place-items-center p-8 bg-pink-100">
      <div className="rounded-2xl border-pink-300 border-2 p-6 max-w-sm w-full space-y-4 bg-pink-50 shadow-lg">
        <h1 className="text-xl font-semibold">{isSignUp ? "Sign up" : "Sign in"}</h1>
        
        <div className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          />

          {isSignUp && (
            <div className="space-y-3">
              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id="privacy-policy"
                  checked={privacyAccepted}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                  className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="privacy-policy" className="text-sm text-gray-700">
                  I accept the{" "}
                  <a
                    href="https://habitblock.com/privacy-policy.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Privacy Policy
                  </a>
                </label>
              </div>

              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id="terms-of-service"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="terms-of-service" className="text-sm text-gray-700">
                  I accept the{" "}
                  <a
                    href="https://habitblock.com/terms-of-service.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Terms of Service
                  </a>
                </label>
              </div>
            </div>
          )}

          <button
            onClick={handleEmailAuth}
            disabled={loading || !email || !password || (isSignUp && (!privacyAccepted || !termsAccepted))}
            className="w-full rounded-lg bg-slate-900 text-white px-3 py-2 hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Loading..." : (isSignUp ? "Sign up" : "Sign in")}
          </button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white px-2 text-gray-500">Or continue with</span>
          </div>
        </div>

        <button onClick={signInWithGoogle} className="w-full rounded-lg border px-3 py-2 hover:bg-slate-50">
          Continue with Google
        </button>

        <p className="text-center text-sm">
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            onClick={() => {
              if (isSignUp) {
                setIsSignUp(false);
              } else {
                // Redirect to pricing page for package selection
                const isDev = window.location.hostname === 'localhost';
                const pricingUrl = isDev
                  ? 'http://localhost:8080/pricing.html'
                  : 'https://habitblock.com/pricing.html';
                window.location.href = pricingUrl;
              }
            }}
            className="text-blue-600 hover:underline"
          >
            {isSignUp ? "Sign in" : "Sign up"}
          </button>
        </p>

        {!isSignUp && (
          <p className="text-center text-sm">
            <button
              onClick={handleForgotPassword}
              disabled={isResettingPassword}
              className="text-blue-600 hover:underline disabled:opacity-50"
            >
              {isResettingPassword ? "Sending..." : "Forgot password?"}
            </button>
          </p>
        )}

      </div>
    </div>
  );
}

/********************* Main App (authed) **********************/
// Error display component
function ErrorDisplay({ error, onRetry, onDismiss }: { 
  error: string; 
  onRetry?: () => void; 
  onDismiss?: () => void; 
}) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <div className="text-red-400 mr-2">⚠️</div>
          <span className="text-sm text-red-700">{error}</span>
        </div>
        <div className="flex items-center gap-2">
          {onRetry && (
            <button 
              onClick={onRetry}
              className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
            >
              Retry
            </button>
          )}
          {onDismiss && (
            <button 
              onClick={onDismiss}
              className="text-xs px-2 py-1 text-red-400 hover:text-red-600"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Loading spinner component
function LoadingSpinner({ size = 'sm' }: { size?: 'xs' | 'sm' | 'md' }) {
  const sizeClasses = {
    xs: 'w-3 h-3',
    sm: 'w-4 h-4', 
    md: 'w-6 h-6'
  }
  
  return (
    <div className={`${sizeClasses[size]} animate-spin rounded-full border-2 border-gray-300 border-t-blue-600`} />
  )
}

function AuthenticatedApp({
  session,
  setNeedsMFAChallenge
}: {
  session: Session;
  setNeedsMFAChallenge: (value: boolean) => void;
}) {
  const userId = session.user.id;

  // Check subscription status
  const subscription = useSubscription(userId);
  const { entitlements, loading: entitlementsLoading } = useEntitlements(userId);

  // Debug subscription status (throttled)
  React.useEffect(() => {
    if (subscription || entitlements) {
      console.log('Subscription status:', { subscription, entitlements, userId });
    }
  }, [subscription?.id, entitlements?.plan_code, userId]);

  // Settings state
  const [showAccountSettings, setShowAccountSettings] = useState(false);

  // New secure data service
  const dataService = useDataService(userId);

  // Check MFA requirement on session load
  useEffect(() => {
    const checkMFARequirement = async () => {
      try {
        // Check if user has MFA enabled and current session requires challenge
        const currentAAL = (session as { aal?: string }).aal || 'aal1';

        // Check if MFA challenge is needed (only once per session)
        if (currentAAL === 'aal1') {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          if (factors && factors.totp && factors.totp.length > 0) {
            // User has MFA enabled but current session is only AAL1
            // Only trigger if we haven't already completed MFA in this session
            const mfaCompleted = sessionStorage.getItem('mfa_completed');
            if (!mfaCompleted) {
              setNeedsMFAChallenge(true);
            }
          }
        }
      } catch (error) {
        console.error('Error checking MFA requirement:', error);
      }
    };

    checkMFARequirement();
  }, [session]);

  // Reset safety flags when user changes
  useEffect(() => {
    console.log("🔄 User changed - resetting safety flags");
    hasCompletedInitialLoadRef.current = false;
    isLoadingDataRef.current = true;
  }, [userId]);

  // State - No localStorage for authenticated users (SaaS security best practice)
  const [schedule, setSchedule] = useState<AnyObj>({});
  const [planName, setPlanName] = useState("");
  const [reflections, setReflections] = useState<AnyObj>({});
  const [visibleObjectives, setVisibleObjectives] = useState<string[]>([]);

  // Change tracking to prevent unnecessary saves during navigation/loading  
  const isLoadingDataRef = useRef<boolean>(true); // Start as TRUE to prevent saves during login
  const hasCompletedInitialLoadRef = useRef<boolean>(false);
  const lastSavedDataRef = useRef<{
    schedule: AnyObj;
    planName: string;
    reflections: AnyObj;
    visibleObjectives: string[];
  }>({
    schedule: {},
    planName: "",
    reflections: {},
    visibleObjectives: []
  });

  const [newObjName, setNewObjName] = useState("");
  const [newObjColor, setNewObjColor] = useState("#10b981");

  const tickColor = dataService.userPreferences?.tick_color || "#16a34a";

  // Week start
  const today = useMemo(() => new Date(), []);
  const [weekStart, setWeekStart] = useState(() => getWeekStart(today, "Monday"));

  // Update week start when user preference changes
  useEffect(() => {
    if (dataService.userPreferences?.week_starts_on) {
      setWeekStart(getWeekStart(today, dataService.userPreferences.week_starts_on));
    }
  }, [dataService.userPreferences?.week_starts_on, today]);

  // Painting state
  const paintingRef = useRef(false);
  const markingRef = useRef<{ active: boolean; to?: boolean }>({ active: false, to: undefined });

  // Touch painting state removed - using simpler scroll zones approach

  // Detect Safari on macOS and all iOS/iPadOS browsers (which are always WebKit)
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isMacSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua);
  const needsBlendFallback = isIOS || isMacSafari;

  // Selected brush (objective id or "eraser")
  const [brush, setBrush] = useState<string | null>(null);
  const brushRef = useRef<string | null>(brush);
  
  // Done mode state
  const [isDoneMode, setIsDoneMode] = useState(false);
  
  // Editing state for objectives
  const [editingObjectiveId, setEditingObjectiveId] = useState<string | null>(null);
  useEffect(() => { brushRef.current = brush; }, [brush]);

  const lastNonEraserBrushRef = useRef<string | null>(null);
  useEffect(() => { if (brush && brush !== 'eraser') lastNonEraserBrushRef.current = brush; }, [brush]);

  // Set initial brush when objectives are loaded
  useEffect(() => {
    const visibleObjs = dataService.objectives.filter(o => !o.archived);
    if (visibleObjs.length > 0 && !brush) {
      setBrush(visibleObjs[0].id);
    }
  }, [dataService.objectives, brush]);

  const toggleEraser = React.useCallback(() => {
    if (brushRef.current === 'eraser') {
      const visibleObjs = dataService.objectives.filter(o => !o.archived);
      const fallback = lastNonEraserBrushRef.current || visibleObjs[0]?.id || null;
      setBrush(fallback);
    } else {
      setBrush('eraser');
    }
  }, [dataService.objectives]);

  // Platform-specific modifier key for UI display
  const modifierKey = React.useMemo(() => {
    if (typeof navigator !== 'undefined') {
      const isMac = navigator.userAgent.includes('Mac') || navigator.userAgent.includes('macOS');
      return isMac ? 'Option' : 'Alt';
    }
    return 'Alt';
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true';
      
      if (isInputField) return;
      
      // Support both Alt+E (Windows/Linux) and Option+E (Mac) for eraser
      // Use e.code to avoid issues with Option+E producing different characters on Mac
      if ((e.code === 'KeyE') && (e.altKey || e.metaKey)) {
        e.preventDefault();
        toggleEraser();
        return;
      }
      else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        // Use the same filtered list as the UI to ensure consistent indexing
        const visibleObjs = dataService.objectives.filter(o => !o.archived);
        const o = visibleObjs[idx];
        if (o) {
          setBrush(o.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dataService.objectives, toggleEraser]);

  // Load data from database when week changes  
  useEffect(() => {
    const weekISO = toISODate(weekStart);
    console.log('📅 [DEBUG] Week load useEffect triggered - weekISO:', weekISO);
    // Always load week when weekStart changes, regardless of currentWeek state
    dataService.loadWeek(weekISO);
  }, [weekStart, dataService.loadWeek]);

  // Sync state with database data - handle both existing and new weeks
  useEffect(() => {
    console.log('🔄 [DEBUG] Data sync useEffect triggered - loading.week:', dataService.loading.week, 'currentWeek exists:', !!dataService.currentWeek);
    // Only process when we've attempted to load the week (not still loading)
    if (!dataService.loading.week) {
      // Set loading flag to prevent autosave during data loading
      isLoadingDataRef.current = true;
      
      // Handle both existing weeks (currentWeek exists) and new weeks (currentWeek is null)
      const newSchedule = (dataService.currentWeek?.schedule as AnyObj) || {};
      const newPlanName = dataService.currentWeek?.plan_name || "";
      const newReflections = (dataService.currentWeek?.reflections as AnyObj) || {};
      
      // DON'T load visibleObjectives from week data - it should persist across weeks as user preference
      // const newVisibleObjectives = dataService.currentWeek?.visible_objectives || [];

      setSchedule(newSchedule);
      setPlanName(newPlanName);
      setReflections(newReflections);
      // setVisibleObjectives(newVisibleObjectives); // REMOVED - keep current filter

      // Update last saved state to match loaded data - will be updated separately for visibleObjectives
      lastSavedDataRef.current = {
        schedule: JSON.parse(JSON.stringify(newSchedule)),
        planName: newPlanName,
        reflections: JSON.parse(JSON.stringify(newReflections)),
        visibleObjectives: lastSavedDataRef.current.visibleObjectives // Keep previous visibleObjectives
      };

      // Clear loading flag after a small delay to ensure all state updates are complete
      setTimeout(() => {
        isLoadingDataRef.current = false;
        // Mark that we've completed at least one data load - now saves are safe
        hasCompletedInitialLoadRef.current = true;
        console.log("Initial data load completed - autosave now enabled");
      }, 100);
    }
  }, [dataService.currentWeek, dataService.loading.week]);


  // Guard invalid settings (ensure end > start)
  useEffect(() => {
    const prefs = dataService.userPreferences;
    if (prefs && prefs.end_minutes <= prefs.start_minutes) {
      const newEnd = prefs.start_minutes + Math.max(10, prefs.slot_minutes || 10);
      dataService.updateUserPreferences({ end_minutes: newEnd });
    }
  }, [dataService.userPreferences?.start_minutes, dataService.userPreferences?.end_minutes, dataService.userPreferences?.slot_minutes, dataService]);

  // Mouse up listener to stop painting
  useEffect(() => {
    const onUp = () => {
      paintingRef.current = false;
      markingRef.current.active = false;
      markingRef.current.to = undefined;
    };
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onUp);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
  }, []);

  // collapsible panels + toasts
  const [clearConfirm, setClearConfirm] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [objectivesCollapsed, setObjectivesCollapsed] = useState(false);
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });
  const [isSaving, setIsSaving] = useState(false);
  const [overwriteNotification, setOverwriteNotification] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [navigationConfirm, setNavigationConfirm] = useState<{
    show: boolean;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  
  // Persist sidebar state to localStorage
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (userMenuOpen && !target.closest('.user-menu')) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) {
      document.addEventListener('click', handleClick);
    }
    return () => document.removeEventListener('click', handleClick);
  }, [userMenuOpen]);

  function flash(msg: string){
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(()=> setNotice(null), 1800);
  }

  // Keep visible filter in sync - only preserve valid selections, don't auto-add new objectives
  useEffect(() => {
    // Don't adjust filter while objectives are loading to prevent race conditions
    if (dataService.loading.objectives) {
      return;
    }
    
    setVisibleObjectives((prev) => {
      const availableIds = dataService.objectives.filter(o => dataService.userPreferences?.show_archived || !o.archived).map((o) => o.id);
      const setIds = new Set(availableIds);
      // Only keep previously selected objectives that are still available
      const filtered = prev.filter((id) => setIds.has(id));
      // If no valid selections remain and there are available objectives, select all available
      if (filtered.length === 0 && availableIds.length > 0) {
        return availableIds;
      }
      return filtered;
    });
  }, [dataService.objectives, dataService.userPreferences, dataService.loading.objectives]);
  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // Derived: days / slots
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const slotCount = useMemo(() => {
    const startMinutes = dataService.userPreferences?.start_minutes || 6 * 60;
    const endMinutes = dataService.userPreferences?.end_minutes || 22 * 60;
    const slotMinutes = dataService.userPreferences?.slot_minutes || 15;
    const total = endMinutes - startMinutes;
    return Math.max(0, Math.floor(total / slotMinutes));
  }, [dataService.userPreferences?.end_minutes, dataService.userPreferences?.start_minutes, dataService.userPreferences?.slot_minutes]);

  const slotStarts = useMemo(() => {
    const startMinutes = dataService.userPreferences?.start_minutes || 6 * 60;
    const slotMinutes = dataService.userPreferences?.slot_minutes || 15;
    return Array.from({ length: slotCount }, (_, i) => startMinutes + i * slotMinutes);
  }, [slotCount, dataService.userPreferences?.start_minutes, dataService.userPreferences?.slot_minutes]);

  // Weekly reflection binding (per-week persistence)
  const weekKey = useMemo(() => toISODate(weekStart), [weekStart]);
  function getDefaultReflection(){ return { mood: null, thought: "", improvements: "", proud: "", results: "" }; }
  const currentReflection = (reflections[weekKey] || getDefaultReflection()) as { mood: string | null; thought: string; improvements: string; proud: string; results: string };
  function setReflection(field: keyof typeof currentReflection, value: string | null){
    setReflections((prev: AnyObj) => {
      const existing = prev[weekKey] || getDefaultReflection();
      return { ...prev, [weekKey]: { ...existing, [field]: value } };
    });
    
    // Immediately mark as having unsaved changes for reflections
    setHasUnsavedChanges(true);
    
    // Note: Save will be triggered by the useEffect watching reflections with 1s debounce
  }

  // Normalize a cell entry to {id, completed}
  function normEntry(entry: unknown): Entry | null {
    if (!entry) return null;
    if (typeof entry === 'string') return { id: entry, completed: false };
    if (typeof entry === 'object' && entry !== null && 'id' in entry) {
      const id = (entry as { id: string }).id;
      const completed = !!(entry as { completed?: boolean }).completed;
      return { id, completed };
    }
    return null;
  }

  // Schedule helpers
  function getDayMap(iso: string) { return schedule[iso] || {}; }
  function setCell(iso: string, slotIndex: number, objectiveId: string | null) {
    setSchedule((prev: AnyObj) => {
      const dayMap = { ...(prev[iso] || {}) };
      if (!objectiveId) delete dayMap[slotIndex];
      else dayMap[slotIndex] = { id: objectiveId, completed: false } as Entry;
      return { ...prev, [iso]: dayMap };
    });
  }
  function setCompleted(iso: string, slotIndex: number, to: boolean) {
    setSchedule((prev: AnyObj) => {
      const dayMap = { ...(prev[iso] || {}) };
      const entry = normEntry(dayMap[slotIndex]);
      if (!entry) return prev;
      dayMap[slotIndex] = { id: entry.id, completed: to } as Entry;
      return { ...prev, [iso]: dayMap };
    });
  }

  // Painting + Marking
  function handleCellMouseDown(iso: string, slotIndex: number, e?: React.MouseEvent) {
    console.log("Cell mouse down:", { iso, slotIndex, altKey: e?.altKey, isDoneMode });
    
    // Done mode or Alt+Click - toggle completion
    if (isDoneMode || e?.altKey) {
      const entry = normEntry(getDayMap(iso)[slotIndex]);
      const desired = entry ? !entry.completed : true;
      setCompleted(iso, slotIndex, desired);
      paintingRef.current = true;
      markingRef.current = { active: true, to: desired };
      return;
    }
    
    paintingRef.current = true;
    markingRef.current = { active: false };
    applyPaint(iso, slotIndex);
  }
  function handleCellEnter(iso: string, slotIndex: number) {
    if (!paintingRef.current) return;
    if (markingRef.current.active) { setCompleted(iso, slotIndex, !!markingRef.current.to); return; }
    applyPaint(iso, slotIndex);
  }
  function applyPaint(iso: string, slotIndex: number) {
    const b = brushRef.current;
    // console.log("Applying paint:", { iso, slotIndex, brush: b });
    
    if (b === "eraser" || !b) {
      console.log("Erasing cell");
      setCell(iso, slotIndex, null);
    } else {
      const existingEntry = normEntry(getDayMap(iso)[slotIndex]);
      const preventOverwrite = dataService.userPreferences?.prevent_overwrite || false;
      
      if (preventOverwrite && existingEntry && existingEntry.id !== b) {
        const existingObj = dataService.objectives.find(obj => obj.id === existingEntry.id);
        const newObj = dataService.objectives.find(obj => obj.id === b);
        
        // If existing objective was deleted/archived, allow overwrite
        if (!existingObj) {
          console.log("Existing objective not found (deleted/archived), allowing overwrite");
          setCell(iso, slotIndex, b);
          return;
        }
        
        const message = `Cannot overwrite "${existingObj.name}" with "${newObj?.name || 'Unknown'}"`;
        setOverwriteNotification(message);
        setTimeout(() => setOverwriteNotification(null), 3000);
        return;
      }
      // console.log("Painting with objective:", b);
      setCell(iso, slotIndex, b);
    }
  }

  // Touch paint support
  function handleTouchMove(e: React.TouchEvent) {
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
    if (!el) return;
    const row = el.getAttribute ? el.getAttribute("data-rowidx") : null;
    const iso = el.getAttribute ? el.getAttribute("data-iso") : null;
    if (row != null && iso) handleCellEnter(iso, Number(row));
  }

  /************** Supabase integration **************/
  // Debounced autosave for week
  const saveTimerRef = useRef<number | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const lastNavigationRef = useRef<number>(0);
  function scheduleSave() {
    // Safety checks already done in callers, just schedule the save
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    
    // Mark as having unsaved changes
    setHasUnsavedChanges(true);
    
    // Different timing for desktop vs mobile
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const debounceTime = isMobile ? 5000 : 1000; // 5s for mobile (backup), 1s for desktop (normal)
    
    saveTimerRef.current = window.setTimeout(() => {
      performSave(weekKey);
    }, debounceTime);
  }

  // Manual save function (bypasses debounce)
  async function manualSave() {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await performSave(weekKey);
  }

  // Safe navigation function that checks for unsaved changes
  function safeNavigate(navigationAction: () => void, actionDescription: string = "navigate") {
    if (hasUnsavedChanges) {
      // Cancel pending auto-save to prevent race condition while dialog is open
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      
      setNavigationConfirm({
        show: true,
        message: `You have unsaved changes. ${actionDescription} without saving?`,
        onConfirm: () => {
          setHasUnsavedChanges(false); // Clear flag since user chose to discard
          setNavigationConfirm(null);
          navigationAction();
        }
      });
    } else {
      navigationAction();
    }
  }

  // Perform save with basic protection
  async function performSave(weekISO: string): Promise<boolean> {
    // Don't save during initial load
    if (!hasCompletedInitialLoadRef.current) {
      console.log("⏳ Skipping save - still loading");
      return false;
    }
    
    // Prevent concurrent saves
    if (isSavingRef.current) {
      console.log("💾 Save already in progress");
      return false;
    }

    isSavingRef.current = true;
    setIsSaving(true);

    try {
      const success = await saveWeek(weekISO);
      if (!success) {
        console.error(`Save failed for week ${weekISO}`);
        flash(`Save failed for week ${weekISO} - data may be lost`);
      }
      return success;
    } catch (error) {
      console.error(`Save error for week ${weekISO}:`, error);
      flash(`Save error for week ${weekISO} - data may be lost`);
      return false;
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }

  // Check if navigation is allowed (throttle rapid navigation)
  function canNavigate(): boolean {
    const now = Date.now();
    const timeSinceLastNav = now - lastNavigationRef.current;
    const throttleMs = 500; // 500ms minimum between navigations
    
    if (timeSinceLastNav < throttleMs) {
      console.log(`Navigation throttled - ${throttleMs - timeSinceLastNav}ms remaining`);
      // Give user feedback for throttled clicks
      flash(`Please wait ${Math.ceil((throttleMs - timeSinceLastNav) / 100) / 10}s between navigation`);
      return false;
    }
    
    lastNavigationRef.current = now;
    return true;
  }


  // Note: Week loading is now handled by the dataService loadWeek effect above

  // ONLY autosave when user actually edits the calendar content
  useEffect(() => {
    // Don't save during initial app load or navigation
    if (!hasCompletedInitialLoadRef.current || isLoadingDataRef.current) {
      return;
    }

    // Only save actual calendar content changes - NO FILTER CHANGES
    const currentData = { schedule, planName, reflections };
    const lastSaved = lastSavedDataRef.current;
    
    const hasCalendarDataChanged = (
      JSON.stringify(currentData.schedule) !== JSON.stringify(lastSaved.schedule) ||
      currentData.planName !== lastSaved.planName
    );

    if (hasCalendarDataChanged) {
      // console.log("📅 CALENDAR CONTENT changed - saving");
      scheduleSave();
    }
  }, [schedule, planName]);

  // Reflection debounce timer (separate from calendar timer)
  const reflectionTimerRef = useRef<number | null>(null);
  
  // Separate effect for reflections with proper debouncing
  useEffect(() => {
    if (!hasCompletedInitialLoadRef.current || isLoadingDataRef.current) {
      return;
    }

    // Clear any existing reflection timer
    if (reflectionTimerRef.current) {
      clearTimeout(reflectionTimerRef.current);
      reflectionTimerRef.current = null;
    }

    // Set new timer only after user stops typing
    reflectionTimerRef.current = window.setTimeout(() => {
      console.log("💭 REFLECTIONS changed - saving");
      scheduleSave();
      reflectionTimerRef.current = null;
    }, 2000); // 2 second debounce for better typing experience

    return () => {
      if (reflectionTimerRef.current) {
        clearTimeout(reflectionTimerRef.current);
        reflectionTimerRef.current = null;
      }
    };
  }, [reflections]);

  // Update filter tracking without saving (filters are just UI state)
  useEffect(() => {
    if (!hasCompletedInitialLoadRef.current || isLoadingDataRef.current) {
      return;
    }

    // Just update tracking - NO SAVE for filter changes
    const lastSaved = lastSavedDataRef.current;
    if (JSON.stringify(visibleObjectives) !== JSON.stringify(lastSaved.visibleObjectives)) {
      console.log("👁️ Filter changed - updating tracking only (no save)");
      
      // Update tracking but don't save
      lastSavedDataRef.current = {
        ...lastSavedDataRef.current,
        visibleObjectives: [...visibleObjectives]
      };
    }
  }, [visibleObjectives]);






  // Note: loadWeek now handled by dataService.loadWeek() via useEffect hooks

  async function saveWeek(weekISO: string): Promise<boolean> {
    const weekData = {
      week_start: weekISO,
      schedule,
      plan_name: planName,
      reflections,
      // visible_objectives removed - it's UI state, not calendar data
    };
    
    const success = await dataService.saveWeek(weekData);
    if (success) {
      // Update last saved state to prevent unnecessary re-saves
      lastSavedDataRef.current = {
        schedule: JSON.parse(JSON.stringify(schedule)),
        planName,
        reflections: JSON.parse(JSON.stringify(reflections)),
        visibleObjectives: [...visibleObjectives]
      };
      console.log(`Save successful for week ${weekISO}`);
      // Clear unsaved changes flag after successful save
      setHasUnsavedChanges(false);
    }
    
    return success;
  }

  /************** Objectives CRUD (UI handlers) **************/
  async function addObjective() {
    // Only count non-archived objectives against the limit
    const activeObjectivesCount = dataService.objectives.filter(o => !o.archived).length;
    const maxObjectives = dataService.userPreferences?.max_objectives || 6;
    if (activeObjectivesCount >= maxObjectives) return;
    const name = newObjName.trim();
    if (!name) return;
    
    const obj = await dataService.createObjective(name, newObjColor || "#10b981");
    if (obj) {
      setBrush(obj.id);
      setNewObjName("");
      // Add the new objective to visible objectives so it shows up immediately
      setVisibleObjectives(prev => [...prev, obj.id]);
      flash(`Added "${obj.name}"`);
    }
  }
  async function updateObjectiveName(id: string, name: string) {
    await dataService.updateObjective(id, { name });
  }
  async function updateObjectiveColor(id: string, color: string) {
    await dataService.updateObjective(id, { color });
  }
  function getObjectiveUsageCount(id: string) {
    let count = 0;
    for (const iso in schedule) {
      const dayMap = schedule[iso] || {};
      for (const k in dayMap) {
        const e = normEntry(dayMap[k]);
        if (e && e.id === id) count++;
      }
    }
    return count;
  }
  async function confirmAndDeleteObjective(obj: { id: string; name: string }) {
    const count = getObjectiveUsageCount(obj.id);
    const deleteMode = dataService.userPreferences?.delete_mode || "soft";
    
    let msg: string;
    if (deleteMode === "soft") {
      msg = `Archive objective "${obj.name}"?${count ? `\nThis will hide it from planning but keep ${count} scheduled block${count > 1 ? 's' : ''} in analytics.` : ''}`;
    } else {
      msg = `Delete objective "${obj.name}" permanently?${count ? `\nThis will remove ${count} scheduled block${count > 1 ? 's' : ''} and all analytics data.` : ''}`;
    }
    
    const ok = window.confirm(msg);
    if (!ok) return;
    
    if (deleteMode === "soft") {
      const success = await dataService.updateObjective(obj.id, { archived: true });
      if (success) {
        // Reload objectives to get updated data including archived
        await dataService.loadObjectives(true);
        flash(`Archived "${obj.name}"`);
      }
    } else {
      const success = await dataService.deleteObjective(obj.id);
      if (success) {
        // Remove from schedule
        setSchedule((prev: AnyObj) => {
          const draft: AnyObj = {};
          for (const iso in prev) {
            const dayMap = prev[iso] || {};
            const nextDay: AnyObj = {};
            for (const k in dayMap) {
              const e = normEntry(dayMap[k]);
              if (e && e.id !== obj.id) nextDay[k] = dayMap[k];
            }
            draft[iso] = nextDay;
          }
          return draft;
        });
        flash(`Deleted "${obj.name}"`);
      }
    }
    
    if (brushRef.current === obj.id) {
      const remainingObjs = dataService.objectives.filter(o => !o.archived && o.id !== obj.id);
      if (remainingObjs.length > 0) {
        setBrush(remainingObjs[0].id);
        brushRef.current = remainingObjs[0].id;
      } else {
        setBrush('eraser');
        brushRef.current = 'eraser';
      }
    }
  }

  async function restoreObjective(obj: { id: string; name: string }) {
    const ok = window.confirm(`Restore objective "${obj.name}"?`);
    if (!ok) return;
    
    const success = await dataService.updateObjective(obj.id, { archived: false });
    if (success) {
      // Reload objectives to get updated data
      await dataService.loadObjectives(true);
      flash(`Restored "${obj.name}"`);
    }
  }

  async function deleteArchivedObjective(obj: { id: string; name: string }) {
    const count = getObjectiveUsageCount(obj.id);
    const msg = `Delete objective "${obj.name}" permanently?${count ? `\nThis will remove ${count} scheduled block${count > 1 ? 's' : ''} and all analytics data.` : ''}`;
    
    const ok = window.confirm(msg);
    if (!ok) return;
    
    const success = await dataService.deleteObjective(obj.id);
    if (success) {
      // Remove from schedule
      setSchedule((prev: AnyObj) => {
        const draft: AnyObj = {};
        for (const iso in prev) {
          const dayMap = prev[iso] || {};
          const nextDay: AnyObj = {};
          for (const k in dayMap) {
            const e = normEntry(dayMap[k]);
            if (e && e.id !== obj.id) nextDay[k] = dayMap[k];
          }
          draft[iso] = nextDay;
        }
        return draft;
      });
      flash(`Deleted "${obj.name}"`);
    }
    
    if (brushRef.current === obj.id) {
      const remainingObjs = dataService.objectives.filter(o => !o.archived && o.id !== obj.id);
      if (remainingObjs.length > 0) {
        setBrush(remainingObjs[0].id);
        brushRef.current = remainingObjs[0].id;
      } else {
        setBrush('eraser');
        brushRef.current = 'eraser';
      }
    }
  }

  /**************** Week ops *****************/
  function clearWeek() {
    if (!clearConfirm) {
      setClearConfirm(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = window.setTimeout(() => setClearConfirm(false), 3000);
      return;
    }
    setClearConfirm(false);
    const isoSet = new Set(days.map((d) => toISODate(d)));
    setSchedule((prev: AnyObj) => {
      const draft: AnyObj = { ...prev };
      for (const iso of isoSet) draft[iso] = {};
      return draft;
    });
    flash("Week cleared");
  }

  async function copyWeekForward(offsetWeeks = 1) {
    console.log("Copy week forward clicked");
    const srcDays = days.map((d) => toISODate(d));
    const destStartRaw = new Date(weekStart);
    destStartRaw.setDate(destStartRaw.getDate() + 7 * offsetWeeks);
    const destStart = getWeekStart(destStartRaw, dataService.userPreferences?.week_starts_on || "Monday");
    const destDays = Array.from({ length: 7 }, (_, i) => {
      const dd = new Date(destStart);
      dd.setDate(dd.getDate() + i);
      return toISODate(dd);
    });

    console.log("Copy details:", { srcDays, destDays, currentSchedule: schedule });

    // Check database for existing data in destination week using DataService
    const destWeekISO = toISODate(destStart);
    
    // Temporarily load destination week data to check for existing blocks
    const tempDataService = new DataService(userId);
    const existingWeek = await tempDataService.getWeek(destWeekISO);
    
    const existingSchedule = (existingWeek?.schedule as AnyObj) || {};
    const existingCount = countWeekBlocks(existingSchedule, destDays);
    console.log("Existing blocks in destination (from DB):", existingCount, existingSchedule);
    
    if (existingCount > 0) {
      console.log("Showing copy confirmation dialog");
      setCopyConfirm({ destStart, destDays, srcDays, existingCount });
      return;
    }

    const { overwrite, count } = buildCopyWeekPatch(schedule, srcDays, destDays, false);
    console.log("Copy patch:", { overwrite, count });
    
    // Save current week first, then copy and navigate
    const currentWeekISO = toISODate(weekStart);
    const saveSuccess = await performSave(currentWeekISO);
    if (saveSuccess) {
      console.log("Current week saved");
      
      // Create the new week data in database using DataService
      const destWeekISO = toISODate(destStart);
      const weekData = {
        week_start: destWeekISO,
        schedule: overwrite,
        plan_name: planName,
        reflections: {},
        // visible_objectives removed - don't copy UI filters
      };
      
      const success = await dataService.saveWeek(weekData);
      
      if (!success) {
        console.error("Failed to save copied week");
        flash("Copy failed - could not save to database");
      } else {
        console.log("Copied week saved to database");
        // Now it's safe to navigate
        setWeekStart(destStart);
        flash(count ? `Copied ${count} block${count !== 1 ? 's' : ''} to next week` : 'No blocks to copy — moved to next week');
      }
    } else {
      flash('Failed to save current week - copy cancelled');
    }
  }

  const [copyConfirm, setCopyConfirm] = useState<null | { destStart: Date; destDays: string[]; srcDays: string[]; existingCount: number }>(null);
  async function handleCopyConfirm(yes: boolean) {
    if (!copyConfirm) return;
    const { srcDays, destDays, destStart, existingCount } = copyConfirm;
    if (yes) {
      const { overwrite, count } = buildCopyWeekPatch(schedule, srcDays, destDays, false);
      console.log("Confirmation copy patch:", { overwrite, count });
      
      // Save current week first, then copy and navigate
      const currentWeekISO = toISODate(weekStart);
      const saveSuccess = await performSave(currentWeekISO);
      if (saveSuccess) {
        console.log("Current week saved for confirmation copy");
        
        // Create the new week data in database using DataService
        const destWeekISO = toISODate(destStart);
        const weekData = {
          week_start: destWeekISO,
          schedule: overwrite,
          plan_name: planName,
          reflections: {},
          // visible_objectives removed - don't copy UI filters  
        };
        
        const success = await dataService.saveWeek(weekData);
        
        if (!success) {
          console.error("Failed to save confirmed copy");
          flash("Copy failed - could not save to database");
        } else {
          console.log("Confirmed copy saved to database");
          // Now it's safe to navigate
          setWeekStart(destStart);
          flash(`Copied ${count} block${count !== 1 ? 's' : ''} to next week (overwrote ${existingCount})`);
        }
      } else {
        flash('Failed to save current week - copy cancelled');
      }
    } else {
      flash('Copy cancelled');
    }
    setCopyConfirm(null);
  }

  // Import/Export (local JSON)
  function exportData() {
    const data = {
      version: 4,
      settings: {
        startMinutes: dataService.userPreferences?.start_minutes || 6 * 60,
        endMinutes: dataService.userPreferences?.end_minutes || 22 * 60,
        slotMinutes: dataService.userPreferences?.slot_minutes || 15,
        weekStartsOn: dataService.userPreferences?.week_starts_on || "Monday",
        tickColor: dataService.userPreferences?.tick_color || "#16a34a",
        showObjectiveNames: dataService.userPreferences?.show_objective_names || false
      },
      objectives: dataService.objectives,
      schedule,
      maxObjectives: dataService.userPreferences?.max_objectives || 6,
      weekStartISO: toISODate(weekStart),
      planName,
      reflections,
      visibleObjectives,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `my-time-palette-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function importData(file: File) {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => {
      try {
        const obj = JSON.parse(e.target?.result as string);
        // Note: settings and objectives import now handled via database preferences
        if (obj.schedule) setSchedule(obj.schedule);
        if (obj.weekStartISO) setWeekStart(fromISODate(obj.weekStartISO));
        if (typeof obj.planName === "string") setPlanName(obj.planName);
        if (obj.reflections) setReflections(obj.reflections);
        if (Array.isArray(obj.visibleObjectives)) setVisibleObjectives(obj.visibleObjectives);
        flash("Imported JSON");
      } catch {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  }

  const weeklyStats = useMemo(() => {
    const daysISO = days.map((d) => toISODate(d));
    const filteredObjectives = dataService.objectives.filter(o => dataService.userPreferences?.show_archived || !o.archived);
    return computeWeeklyStats(filteredObjectives, daysISO, schedule, dataService.userPreferences?.slot_minutes || 15);
  }, [dataService.objectives, days, schedule, dataService.userPreferences]);

  const visibleSet = useMemo(() => new Set(visibleObjectives), [visibleObjectives]);

  // Visible objectives handlers
  function handleVisibleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = Array.from(e.target.selectedOptions, option => option.value);
    setVisibleObjectives(selected);
  }
  
  function selectAllVisible() {
    setVisibleObjectives(dataService.objectives.filter(o => dataService.userPreferences?.show_archived || !o.archived).map(o => o.id));
  }

  /*********************** Render ************************/
  // Debug logging (commented out for performance)
  // console.log("DataService state:", {
  //   objectives: dataService.objectives.length,
  //   objectiveIds: dataService.objectives.map(o => o.id),
  //   visibleObjectives: visibleObjectives.length,
  //   currentWeek: dataService.currentWeek ? "exists" : "null",
  //   loading: dataService.loading,
  //   errors: dataService.errors,
  //   userPreferences: dataService.userPreferences ? "exists" : "null",
  //   weekStart: toISODate(weekStart)
  // });

  // Show loading while checking entitlements
  if (entitlementsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mx-auto mb-4"></div>
          <p className="text-slate-600">Checking subscription...</p>
        </div>
      </div>
    );
  }

  // Enforce paywall - check both entitlements and subscription as fallback
  if (!entitlements && !subscription) {
    return <Paywall />;
  }

  return (
    <div className="min-h-screen w-full bg-white text-slate-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src={habitblockLogo} alt="Habitblock" className="h-8 w-auto" />
                <div>
                  <h1 className="text-xl font-semibold leading-tight">Habitblock</h1>
                  <p className="text-xs text-slate-500 font-medium">My secret to success</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2 sm:hidden">
                <a
                  href="/analytics"
                  className="p-2 rounded-lg border hover:bg-slate-100"
                  aria-label="View analytics"
                >
                  📊
                </a>
                <button
                  onClick={() => {
                    const willOpen = !settingsPanelOpen;
                    setSettingsPanelOpen(willOpen);
                    // Refresh hasAnyWeeks when opening settings panel
                    if (willOpen) {
                      if (dataService.checkHasAnyWeeks) {
                        // Clear cache to ensure fresh database check
                        dataService.clearCache();
                        dataService.checkHasAnyWeeks();
                      }
                    }
                  }}
                  className="p-2 rounded-lg border hover:bg-slate-100"
                  aria-label="Toggle settings"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1.51-1V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                </button>
                <div className="relative user-menu">
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="w-8 h-8 rounded-full bg-slate-700 text-white flex items-center justify-center hover:bg-slate-800"
                    aria-label="Toggle user menu"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                  </button>
                  
                  {userMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                      <div className="p-3 border-b border-slate-100">
                        <div className="text-sm font-medium text-slate-900">Signed in as</div>
                        <div className="text-sm text-slate-600 truncate">{session.user.email}</div>
                      </div>
                      <div className="p-1">
                        <button
                          onClick={() => {
                            setUserMenuOpen(false);
                            setShowAccountSettings(true);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md"
                          aria-label="Account Settings"
                        >
                          ⚙️ Account Settings
                        </button>
                        <button
                          onClick={async () => {
                            setUserMenuOpen(false);
                            console.log("Signing out and clearing all data");
                            // Clear all localStorage data
                            localStorage.clear();
                            // Clear MFA session flag
                            sessionStorage.removeItem('mfa_completed');
                            // Sign out from Supabase with Google session clearing
                            await supabase.auth.signOut({
                              scope: 'global' // This attempts to clear Google session too
                            });
                            // Force page reload to ensure clean state
                            window.location.reload();
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md"
                          aria-label="Sign out"
                        >
                          🚪 Sign out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="sm:flex-1 sm:max-w-md">
              <input 
                type="text" 
                value={planName} 
                onChange={(e) => setPlanName(e.target.value)} 
                placeholder="Name your plan…" 
                className="w-full text-sm border-b border-slate-300 focus:border-slate-600 outline-none bg-transparent px-1 py-1" 
              />
              <p className="text-xs text-slate-500 mt-1">Click an objective to select, then paint your week.</p>
            </div>
            
            <div className="hidden sm:flex items-center gap-3">
              <a
                href="/analytics"
                className="px-3 py-1.5 rounded-lg border hover:bg-slate-100 text-sm"
                aria-label="View analytics"
              >
                📊 Analytics
              </a>
              <button
                onClick={() => {
                  const willOpen = !settingsPanelOpen;
                  setSettingsPanelOpen(willOpen);
                  // Refresh hasAnyWeeks when opening settings panel
                  if (willOpen) {
                    if (dataService.checkHasAnyWeeks) {
                      // Clear cache to ensure fresh database check
                      dataService.clearCache();
                      dataService.checkHasAnyWeeks();
                    }
                  }
                }}
                className="p-2 rounded-lg border hover:bg-slate-100"
                aria-label="Toggle settings"
                title="Settings"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1.51-1V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </button>
              <div className="relative user-menu">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="w-8 h-8 rounded-full bg-slate-700 text-white flex items-center justify-center hover:bg-slate-800"
                  aria-label="Toggle user menu"
                  title="User menu"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                </button>
                
                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-50">
                    <div className="p-3 border-b border-slate-100">
                      <div className="text-sm font-medium text-slate-900">Signed in as</div>
                      <div className="text-sm text-slate-600 truncate">{session.user.email}</div>
                    </div>
                    <div className="p-1">
                      <button
                        onClick={() => {
                          setUserMenuOpen(false);
                          setShowAccountSettings(true);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md"
                        aria-label="Account Settings"
                      >
                        ⚙️ Account Settings
                      </button>
                      <button
                        onClick={async () => {
                          setUserMenuOpen(false);
                          console.log("Signing out and clearing all data");
                          // Clear all localStorage data
                          localStorage.clear();
                          // Clear MFA session flag
                          sessionStorage.removeItem('mfa_completed');
                          // Sign out from Supabase with Google session clearing
                          await supabase.auth.signOut({
                            scope: 'global' // This attempts to clear Google session too
                          });
                          // Force page reload to ensure clean state
                          window.location.reload();
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md"
                        aria-label="Sign out"
                      >
                        🚪 Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-12 gap-4 p-4 relative">
        {/* Fixed save indicator that doesn't affect layout */}
        {isSaving && (
          <div className="fixed top-4 right-4 z-50 px-3 py-2 text-sm text-blue-600 bg-blue-50 rounded-lg border border-blue-200 shadow-sm" aria-live="polite">
            💾 Saving...
          </div>
        )}
        {/* Sidebar */}
        <aside className={`${sidebarCollapsed ? 'hidden lg:block lg:col-span-1' : 'col-span-12 lg:col-span-4 xl:col-span-3'} space-y-4`}>
          {sidebarCollapsed ? (
            /* Collapsed Sidebar - Icon Strip */
            <div className="flex flex-col gap-3 sticky top-24 h-fit">
              {/* Expand Sidebar Icon at top */}
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="w-8 h-8 bg-slate-100 rounded-full shadow border hover:bg-slate-200 flex items-center justify-center group transition-colors"
                title="Expand Sidebar"
                aria-label="Expand full sidebar"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
                  <rect width="18" height="18" x="3" y="3" rx="2"></rect>
                  <path d="M9 3v18"></path>
                </svg>
              </button>

              {/* Objectives Icon */}
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="w-8 h-8 bg-amber-50 rounded-full shadow border hover:bg-amber-100 flex items-center justify-center group transition-colors"
                title="Expand Objectives"
                aria-label="Expand objectives panel"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-700">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M12 1v6"></path>
                  <path d="M12 17v6"></path>
                  <path d="m4.2 4.2 4.3 4.3"></path>
                  <path d="m15.5 15.5 4.3 4.3"></path>
                  <path d="M1 12h6"></path>
                  <path d="M17 12h6"></path>
                  <path d="m4.2 19.8 4.3-4.3"></path>
                  <path d="m15.5 8.5 4.3-4.3"></path>
                </svg>
              </button>
              
              {/* Weekly Summary Icon */}
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="w-8 h-8 bg-sky-50 rounded-full shadow border hover:bg-sky-100 flex items-center justify-center group transition-colors"
                title="Expand Weekly Summary"
                aria-label="Expand weekly summary panel"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-700">
                  <path d="M3 3v18h18"></path>
                  <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"></path>
                </svg>
              </button>
            </div>
          ) : (
            /* Expanded Sidebar - Full Content */
            <div className="space-y-4">
              {/* Collapse Button */}
              <div className="flex justify-end">
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className="text-slate-500 hover:text-slate-700 p-1"
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2"></rect>
                    <path d="M9 3v18"></path>
                  </svg>
                </button>
              </div>
              
              {/* Objectives */}
              <section className="bg-amber-50 rounded-2xl shadow-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Objectives</h2>
              <div className="flex items-center gap-2">
                <div className="text-sm text-slate-500">{dataService.objectives.filter(o => !o.archived).length}/{dataService.userPreferences?.max_objectives || 6}</div>
                <button 
                  onClick={() => setObjectivesCollapsed(!objectivesCollapsed)}
                  className="text-slate-500 hover:text-slate-700"
                  aria-label={objectivesCollapsed ? "Expand objectives" : "Collapse objectives"}
                >
                  {objectivesCollapsed ? "▶" : "▼"}
                </button>
              </div>
            </div>

            {!objectivesCollapsed && (
              <div className="space-y-3">
                <div className="text-xs text-slate-500">Click an objective to <b>select</b>, then paint on the calendar.</div>
                
                {/* Error handling for objectives */}
                {dataService.errors.objectives && (
                  <ErrorDisplay 
                    error={dataService.errors.objectives}
                    onRetry={() => dataService.retry('objectives')}
                    onDismiss={() => dataService.clearErrors()}
                  />
                )}

                {/* Loading state */}
                {dataService.loading.objectives && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <LoadingSpinner size="xs" />
                    Loading objectives...
                  </div>
                )}

                {dataService.objectives.filter(o => !o.archived).map((o) => (
                  <div key={o.id} className={`group relative flex items-center gap-3 p-2 pl-12 pr-10 rounded-xl border ${brush === o.id ? "border-slate-900 hover:border-slate-700 hover:bg-slate-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"} cursor-pointer hover:shadow-sm transition-all`}
                    onClick={() => { setBrush(o.id); }} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setBrush(o.id); } }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); confirmAndDeleteObjective(o); }}
                      className="h-7 w-7 grid place-items-center rounded-md text-xs leading-none p-0 hover:bg-red-50 hover:text-red-600 absolute left-2 opacity-100 xl:opacity-0 xl:group-hover:opacity-100 transition-opacity"
                      aria-label={`Delete ${o.name}`} title="Delete objective">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3,6 5,6 21,6"></polyline>
                        <path d="M19,6V20a2,2 0 0,1-2,2H7a2,2 0 0,1-2-2V6M8,6V4a2,2 0 0,1,2-2h4a2,2 0 0,1,2,2V6"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                      </svg>
                    </button>
                    <div className="h-6 w-6 rounded-md border" style={{ background: o.color }} />
                    {editingObjectiveId === o.id ? (
                      <input type="text" 
                        onClick={(e) => e.stopPropagation()} 
                        value={o.name}
                        onChange={(e) => updateObjectiveName(o.id, e.target.value)} 
                        onBlur={() => setEditingObjectiveId(null)}
                        onKeyDown={(e) => { 
                          e.stopPropagation();
                          if (e.key === 'Enter' || e.key === 'Escape') {
                            setEditingObjectiveId(null);
                          }
                        }}
                        maxLength={MAX_OBJECTIVE_NAME_LENGTH}
                        className="flex-1 text-sm bg-white border border-slate-200 rounded-md px-2 py-1"
                        autoFocus />
                    ) : (
                      <div 
                        className="flex-1 text-sm px-2 py-1 rounded-md transition-colors"
                        onDoubleClick={(e) => { 
                          e.stopPropagation(); 
                          setEditingObjectiveId(o.id); 
                        }}
                        title="Double-click to edit"
                      >
                        {o.name}
                      </div>
                    )}
                    <input type="color" onClick={(e) => e.stopPropagation()} title="Pick color"
                      value={o.color} onChange={(e) => updateObjectiveColor(o.id, e.target.value)} className="h-6 w-6 p-0 border rounded absolute right-2" />
                  </div>
                ))}

                <div className="flex items-center gap-2">
                  <input type="text" placeholder="New objective name" value={newObjName} 
                    onChange={(e) => setNewObjName(e.target.value)} 
                    maxLength={MAX_OBJECTIVE_NAME_LENGTH}
                    className="flex-1 text-sm border rounded-lg px-2 py-2" />
                  <input type="color" title="New objective color" value={newObjColor} onChange={(e) => setNewObjColor(e.target.value)} className="h-6 w-6 p-0 border rounded" />
                  <button disabled={dataService.objectives.filter(o => !o.archived).length >= (dataService.userPreferences?.max_objectives || 6) || newObjName.trim() === ""} onClick={addObjective} className="px-3 py-2 rounded-xl border bg-slate-900 text-white disabled:bg-slate-200 disabled:text-slate-500">Add</button>
                </div>
              </div>
            )}
          </section>

          {/* Weekly Summary */}
          <section className="bg-sky-50 rounded-2xl shadow-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Weekly Summary</h2>
              <button 
                onClick={() => setSummaryCollapsed(!summaryCollapsed)}
                className="text-slate-500 hover:text-slate-700"
                aria-label={summaryCollapsed ? "Expand summary" : "Collapse summary"}
              >
                {summaryCollapsed ? "▶" : "▼"}
              </button>
            </div>
            {!summaryCollapsed && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-left py-1">Objective</th>
                      <th className="text-right py-1">Hours</th>
                      <th className="text-right py-1">% Done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyStats.map((s) => (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color }} />
                            <span>{s.name}</span>
                          </div>
                        </td>
                        <td className="py-2 text-right tabular-nums">{s.hours.toFixed(2)}h</td>
                        <td className="py-2 text-right tabular-nums" title={`${s.completedSlots}/${s.slots} slots done`}>{Math.round(s.percent)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
              </section>
              
            </div>
          )}
        </aside>

        {/* Calendar */}
        <section className={`${sidebarCollapsed ? 'col-span-12 lg:col-span-11' : 'col-span-12 lg:col-span-8 xl:col-span-9'}`}>
          {/* Week Navigation */}
          <div className="mb-3">
            {/* First row - Navigation buttons and date picker */}
            <div className="flex items-center gap-3 mb-3 sm:mb-0">
              <button 
                onClick={() => {
                  // Throttle rapid navigation
                  if (!canNavigate()) return;
                  
                  safeNavigate(() => {
                    const newDate = new Date(weekStart);
                    newDate.setDate(newDate.getDate() - 7);
                    setWeekStart(getWeekStart(newDate, dataService.userPreferences?.week_starts_on || "Monday"));
                  }, "Go to previous week");
                }} 
                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                aria-label="Previous week"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
              </button>
              <button 
                onClick={() => {
                  // Throttle rapid navigation
                  if (!canNavigate()) return;
                  
                  safeNavigate(() => {
                    setWeekStart(getWeekStart(new Date(), dataService.userPreferences?.week_starts_on || "Monday"));
                  }, "Go to current week");
                }} 
                className="px-5 py-1.5 rounded-full bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors"
                aria-label="Go to current week"
              >
                Today
              </button>
              <button 
                onClick={async () => {
                  // Throttle rapid navigation
                  if (!canNavigate()) return;
                  
                  safeNavigate(() => {
                    const newDate = new Date(weekStart);
                    newDate.setDate(newDate.getDate() + 7);
                    setWeekStart(getWeekStart(newDate, dataService.userPreferences?.week_starts_on || "Monday"));
                  }, "Go to next week");
                }} 
                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                aria-label="Next week"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
              
              <div className="ml-2 sm:ml-8 relative">
                <button
                  onClick={() => {
                    const input = document.getElementById('week-date-picker') as HTMLInputElement;
                    if (input) input.showPicker();
                  }}
                  className="px-3 sm:px-5 py-1.5 bg-gray-200 text-gray-800 rounded-full font-medium flex items-center gap-2 hover:bg-gray-300 transition-colors text-sm sm:text-base"
                  aria-label="Select week date range"
                >
                  {(() => {
                    const weekEnd = new Date(weekStart);
                    weekEnd.setDate(weekEnd.getDate() + 6);
                    const startMonth = weekStart.toLocaleDateString(undefined, { month: 'short' });
                    const startDay = weekStart.getDate();
                    const endMonth = weekEnd.toLocaleDateString(undefined, { month: 'short' });
                    const endDay = weekEnd.getDate();
                    
                    if (startMonth === endMonth) {
                      return `${startMonth} ${startDay} - ${endDay}`;
                    } else {
                      return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
                    }
                  })()}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sm:w-4 sm:h-4">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
                <input 
                  id="week-date-picker"
                  aria-label="Jump to date" 
                  type="date" 
                  value={toISODate(weekStart)} 
                  onChange={(e) => { 
                    const d = fromISODate(e.target.value); 
                    setWeekStart(getWeekStart(d, dataService.userPreferences?.week_starts_on || "Monday")); 
                  }} 
                  className="absolute opacity-0 pointer-events-none" 
                />
              </div>

              {/* Show Filter - desktop version */}
              <div className="hidden sm:flex items-center gap-2 rounded-xl px-3 py-2 shadow-md" style={{ backgroundColor: '#f8f8f8' }} title="Hold Ctrl/Cmd to select multiple">
                <span className="font-bold">Show</span>
                <select multiple value={visibleObjectives} onChange={handleVisibleChange} className="outline-none min-w-[8rem] h-24" aria-label="Filter objectives shown on calendar">
                  {dataService.objectives.filter(o => dataService.userPreferences?.show_archived || !o.archived).map((o) => (<option key={o.id} value={o.id}>{o.name}{o.archived ? ' (archived)' : ''}</option>))}
                </select>
                <div className="flex flex-col gap-1">
                  <button type="button" onClick={selectAllVisible} className={`px-2 py-0.5 rounded border text-xs ${visibleObjectives.length === dataService.objectives.filter(o => dataService.userPreferences?.show_archived || !o.archived).length ? 'bg-slate-900 text-white' : ''}`} aria-label="Show all objectives">All</button>
                </div>
              </div>
            </div>

            {/* Second row for mobile - Show Filter */}
            <div className="flex items-center gap-3 sm:hidden">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2 shadow-md" style={{ backgroundColor: '#f8f8f8' }} title="Hold Ctrl/Cmd to select multiple">
                <span className="font-bold text-sm">Show</span>
                <select multiple value={visibleObjectives} onChange={handleVisibleChange} className="outline-none min-w-[6rem] h-20 text-xs" aria-label="Filter objectives shown on calendar">
                  {dataService.objectives.filter(o => dataService.userPreferences?.show_archived || !o.archived).map((o) => (<option key={o.id} value={o.id}>{o.name}{o.archived ? ' (archived)' : ''}</option>))}
                </select>
                <div className="flex flex-col gap-1">
                  <button type="button" onClick={selectAllVisible} className={`px-2 py-0.5 rounded border text-xs ${visibleObjectives.length === dataService.objectives.filter(o => dataService.userPreferences?.show_archived || !o.archived).length ? 'bg-slate-900 text-white' : ''}`} aria-label="Show all objectives">All</button>
                </div>
              </div>
            </div>
          </div>
          
          {/* Quick Tools */}
          <div className="mb-3 flex flex-wrap items-center gap-2 justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {/* Mobile Sidebar Toggle - only show when collapsed and on mobile */}
              {sidebarCollapsed && (
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  className="lg:hidden px-3 py-2 rounded-xl border hover:bg-slate-100 flex items-center gap-2"
                  aria-label="Show objectives and summary"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2"></rect>
                    <path d="M9 3v18"></path>
                  </svg>
                  Panels
                </button>
              )}
              <div className="flex items-center gap-2 rounded-xl px-3 py-2 shadow-md transition-all duration-200" style={{ backgroundColor: '#ffc107' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#ffb300'; e.currentTarget.classList.remove('shadow-md'); e.currentTarget.classList.add('shadow-lg'); }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#ffc107'; e.currentTarget.classList.remove('shadow-lg'); e.currentTarget.classList.add('shadow-md'); }}>
                <span className="font-semibold text-gray-800">Objective</span>
                <select value={brush === "eraser" ? "" : (brush || "")} onChange={(e) => { setBrush(e.target.value); }} className="outline-none bg-transparent font-bold text-gray-800" aria-label="Active objective">
                  {dataService.objectives.filter(o => !o.archived).map((o, idx) => (<option key={o.id} value={o.id}>{`${idx+1}. ${o.name}`}</option>))}
                </select>
              </div>

              <button type="button" onClick={() => {
                if (isDoneMode) {
                  setIsDoneMode(false);
                } else {
                  setIsDoneMode(true);
                  // If eraser is active, deactivate it
                  if (brush === 'eraser') {
                    const visibleObjs = dataService.objectives.filter(o => !o.archived);
                    const fallback = lastNonEraserBrushRef.current || visibleObjs[0]?.id || null;
                    setBrush(fallback);
                  }
                }
              }} aria-pressed={isDoneMode} className={`px-3 py-2 rounded-xl border ${isDoneMode ? "bg-slate-900 text-white" : ""}`} style={{ backgroundColor: isDoneMode ? undefined : '#f8f8f8' }} title={`Toggle done mode (Alt+Click)`} aria-label="Toggle done mode">✓ Done</button>

              <button type="button" onClick={() => {
                if (brush === 'eraser') {
                  const visibleObjs = dataService.objectives.filter(o => !o.archived);
                  const fallback = lastNonEraserBrushRef.current || visibleObjs[0]?.id || null;
                  setBrush(fallback);
                } else {
                  setBrush('eraser');
                  // If done mode is active, deactivate it
                  setIsDoneMode(false);
                }
              }} aria-pressed={brush==="eraser"} aria-label="Toggle eraser" className={`px-3 py-2 rounded-xl border ${brush==="eraser"?"bg-slate-900 text-white":""}`} style={{ backgroundColor: brush==="eraser" ? undefined : '#f8f8f8' }} title={`Toggle eraser (${modifierKey}+E)`}>🧽 Eraser</button>

              <button type="button" onClick={clearWeek} className="px-3 py-2 rounded-xl border" style={{ backgroundColor: '#f8f8f8' }} title="Clear week" aria-label="Clear week">{clearConfirm ? 'Confirm clear' : '🧹 Clear week'}</button>
              <button type="button" onClick={() => copyWeekForward(1)} className="px-3 py-2 rounded-xl border" style={{ backgroundColor: '#f8f8f8' }} title="Copy to next week" aria-label="Copy to next week">📋 Copy → next week</button>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow overflow-hidden border border-gray-300">
            {/* Save button above calendar - positioned above Sunday column */}
            <div className="flex justify-end pb-2 pt-2 pr-4">
              <button
                onClick={manualSave}
                disabled={isSaving || !hasUnsavedChanges}
                className={`px-4 py-2 rounded-full flex items-center gap-2 text-sm font-medium transition-all duration-200 ${
                  isSaving
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : hasUnsavedChanges
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : 'bg-green-500 text-white hover:bg-green-600'
                }`}
                aria-label={isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save changes' : 'All changes saved'}
              >
                {isSaving ? (
                  <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div> Saving...</>
                ) : hasUnsavedChanges ? (
                  <><svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg> Blocks not saved</>
                ) : (
                  <><svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg> Blocks saved</>
                )}
              </button>
            </div>
            <div className="relative max-h-[70vh] overflow-auto pr-6">
              {/* Scroll handle gutter (mobile-friendly) */}
              <div
                aria-label="Scroll"
                className="pointer-events-auto touch-pan-y absolute right-0 top-0 bottom-0 w-6 z-30
                           bg-gradient-to-l from-slate-200/60 to-transparent opacity-40 hover:opacity-70
                           rounded-l"
                title="Scroll"
              ></div>

              {/* Header Row */}
              <div className="grid sticky top-0 z-20 bg-slate-100" style={{ gridTemplateColumns: `5rem repeat(7, minmax(0, 1fr))` }}>
                <div className="bg-slate-100 border-b border-slate-200 p-3 text-sm font-medium">Time</div>
                {days.map((d, i) => (
                  <div key={i} className="bg-slate-100 border-b border-slate-200 p-3 text-sm font-medium text-center">
                    <div>{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                    <div className="text-slate-500">{d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                  </div>
                ))}
              </div>

              {/* Grid */}
              <div
                className="grid select-none touch-none"
                style={{ gridTemplateColumns: `5rem repeat(7, minmax(0, 1fr))` }}
              >
                {/* Time labels column - Allow scrolling here */}
                <div className="relative sticky left-0 z-10 bg-white touch-pan-y">
                  {slotStarts.map((m, rowIdx) => {
                    const { time, period } = formatTimeLabel(m);
                    return (
                      <div key={rowIdx} className="h-10 border-b border-slate-100 text-xs text-center px-2 flex flex-col justify-center">
                        <div className="font-medium">{time}</div>
                        <div className="text-slate-500">{period}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Day columns */}
                {days.map((d, colIdx) => {
                  const iso = toISODate(d);
                  const dayMap = getDayMap(iso);
                  return (
                    <div key={colIdx} className="relative">
                      {slotStarts.map((_, rowIdx) => {
                        const entry = normEntry(dayMap ? dayMap[rowIdx] : undefined);
                        const objective = entry ? dataService.objectives.find((o) => o.id === entry.id && (dataService.userPreferences?.show_archived || !o.archived)) : null;
                        const isVisible = objective ? visibleSet.has(objective.id) : false;
                        const completed = entry ? entry.completed : false;
                        const titleText = objective && isVisible
                          ? 'Alt-drag to toggle done'
                          : (!brush || brush==='eraser' ? 'Select an objective or use eraser' : 'Paint');
                        return (
                          <div
                            key={rowIdx}
                            className={`relative h-10 border-b border-l border-slate-100 cursor-crosshair group`}
                            onMouseDown={(e) => handleCellMouseDown(iso, rowIdx, e)}
                            onMouseEnter={() => handleCellEnter(iso, rowIdx)}
                            onTouchStart={() => handleCellMouseDown(iso, rowIdx)}
                            onTouchMove={handleTouchMove}
                            data-rowidx={rowIdx}
                            data-iso={iso}
                            style={{ background: objective && isVisible ? (objective.color + '22') : undefined }}
                            title={titleText}
                          >
                            {objective && isVisible && (
                              <div
                                className="h-full w-full isolate"
                                style={{ background: objective.color, pointerEvents: 'none', position: 'relative' }}
                              >
                                {completed && (
                                  <div
                                    className="absolute inset-0 z-0"
                                    style={{
                                      ...(needsBlendFallback ? {
                                        // Safari: Striped pattern with solid tick color
                                        backgroundImage: `repeating-linear-gradient(45deg, ${tickColor} 0 2px, rgba(255,255,255,0.4) 2px 6px)`,
                                        opacity: 0.4
                                      } : {
                                        // Other browsers: Keep original stripe pattern with blend mode
                                        backgroundImage: `repeating-linear-gradient(45deg, ${tickColor}33 0 8px, transparent 8px 16px)`,
                                        mixBlendMode: 'multiply'
                                      }),
                                      pointerEvents: 'none'
                                    }}
                                  />
                                )}
                                {/* Text rendering: Safari gets simple path, others get complex layering */}
                                {dataService.userPreferences?.show_objective_names && objective && (
                                  needsBlendFallback ? (
                                    // Safari/iOS: Simple positioning, no z-index complexity, no drop-shadow
                                    <div className="relative h-full w-full flex items-center justify-center pointer-events-none">
                                      <span className="text-[10px] text-white font-bold px-1 text-center leading-tight truncate w-full">
                                        {objective.name}
                                      </span>
                                    </div>
                                  ) : (
                                    // Chrome/Edge/Firefox: Keep existing complex layering
                                    <div className="absolute inset-0 z-10 flex items-center justify-center" style={{WebkitTransform: 'translateZ(0)'}}>
                                      <span className="text-[10px] text-white font-semibold drop-shadow-md px-1 text-center leading-tight truncate w-full">
                                        {objective.name}
                                      </span>
                                    </div>
                                  )
                                )}
                              </div>
                            )}
                            {(!objective || !isVisible) && <div className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 pl-1 pt-1 select-none">paint</div>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-3">
            <div className="text-sm text-slate-500">Tip: 1-9 choose objective, <kbd>{modifierKey}+E</kbd> eraser, hold <kbd>{modifierKey}</kbd> to mark while dragging.</div>
          </div>

          {/* Weekly Reflection Widget */}
          <section className="mt-4 bg-white rounded-2xl shadow-lg p-4 space-y-3 border border-gray-300">
            <div className="bg-gray-100 -m-4 mb-3 p-4 rounded-t-2xl flex items-center justify-between">
              <h2 className="font-semibold">Weekly Reflection</h2>
              <button
                onClick={manualSave}
                disabled={isSaving || !hasUnsavedChanges}
                className={`px-4 py-2 rounded-full flex items-center gap-2 text-sm font-medium transition-all duration-200 ${
                  isSaving
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : hasUnsavedChanges
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : 'bg-green-500 text-white hover:bg-green-600'
                }`}
                aria-label={isSaving ? 'Saving reflections...' : hasUnsavedChanges ? 'Save reflections' : 'Reflections saved'}
              >
                {isSaving ? (
                  <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div> Saving...</>
                ) : hasUnsavedChanges ? (
                  <><svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg> Reflections not saved</>
                ) : (
                  <><svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg> Reflections saved</>
                )}
              </button>
            </div>
            <div>
              <div className="text-base font-semibold text-slate-600 mb-2">How did this week feel?</div>
              <div className="flex items-center gap-3">
                {[
                  { key: 'happy', label: 'Happy/Productive', emoji: '😊' },
                  { key: 'sad', label: 'Unproductive', emoji: '🙁' },
                  { key: 'neutral', label: 'Not sure', emoji: '😐' },
                ].map((m) => (
                  <button key={m.key} type="button" onClick={() => setReflection('mood', m.key)} className={`px-3 py-2 rounded-xl border text-sm ${currentReflection.mood === m.key ? 'bg-slate-900 text-white' : ''}`} title={m.label} aria-pressed={currentReflection.mood === m.key} aria-label={m.label}>
                    {m.emoji} {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="text-base font-semibold text-slate-600">What went well / what are you proud of?</span>
                  <span className="text-xs text-slate-400">{currentReflection.proud.length}/500</span>
                </div>
                <textarea 
                  className="border rounded-2xl p-2" 
                  rows={3} 
                  value={currentReflection.proud} 
                  onChange={(e)=> setReflection('proud', e.target.value.slice(0, 500))} 
                  maxLength={500}
                />
              </label>
              <label className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="text-base font-semibold text-slate-600">What will you improve next week?</span>
                  <span className="text-xs text-slate-400">{currentReflection.improvements.length}/500</span>
                </div>
                <textarea 
                  className="border rounded-2xl p-2" 
                  rows={3} 
                  value={currentReflection.improvements} 
                  onChange={(e)=> setReflection('improvements', e.target.value.slice(0, 500))} 
                  maxLength={500}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-base font-semibold text-slate-600">Results</span>
                <span className="text-xs text-slate-400">{(currentReflection.results || '').length}/250</span>
              </div>
              <textarea 
                className="border rounded-2xl p-2" 
                rows={3} 
                value={currentReflection.results || ''} 
                onChange={(e)=> setReflection('results', e.target.value.slice(0, 250))} 
                maxLength={250}
              />
            </label>
            <label className="flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-base font-semibold text-slate-600">Free notes / thoughts</span>
                <span className="text-xs text-slate-400">{currentReflection.thought.length}/1000</span>
              </div>
              <textarea 
                className="border rounded-2xl p-2" 
                rows={3} 
                value={currentReflection.thought} 
                onChange={(e)=> setReflection('thought', e.target.value.slice(0, 1000))} 
                maxLength={1000}
              />
            </label>
          </section>
        </section>

        {/* Copy override confirm */}
        {copyConfirm && (
          <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 bg-white border border-slate-200 shadow-lg rounded-xl p-3">
            <div className="text-sm mb-2">
              Next week already has <b>{copyConfirm.existingCount}</b> block{copyConfirm.existingCount !== 1 ? 's' : ''}.<br />
              Do you want to <b>override</b> with a copy of this week?
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => handleCopyConfirm(false)} className="px-3 py-1.5 rounded-lg border">No</button>
              <button onClick={() => handleCopyConfirm(true)} className="px-3 py-1.5 rounded-lg border bg-slate-900 text-white">Yes, override</button>
            </div>
          </div>
        )}

        {/* Overwrite notification */}
        {overwriteNotification && (
          <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 bg-red-50 border border-red-200 shadow-lg rounded-xl p-3">
            <div className="text-sm text-red-800">
              {overwriteNotification}
            </div>
          </div>
        )}

        {/* Settings Panel */}
        {settingsPanelOpen && (
          <div className="fixed top-20 right-0 h-[calc(100vh-5rem)] w-80 bg-white shadow-lg z-50">
            <div className="h-full flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold">Settings</h2>
                <button
                  onClick={() => setSettingsPanelOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                  aria-label="Close settings"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              
              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 text-sm">
                    <label className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2">
                      <span>Start time</span>
                      <input aria-label="Start time" type="time" value={minutesToTimeStr(dataService.userPreferences?.start_minutes || 6 * 60)} onChange={(e) => { const v = timeStrToMinutes(e.target.value); dataService.updateUserPreferences({ start_minutes: v }); }} className="outline-none disabled:bg-gray-100 disabled:text-gray-400" disabled={dataService.hasAnyWeeks === true} />
                    </label>
                    <label className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2">
                      <span>End time</span>
                      <input aria-label="End time" type="time" value={minutesToTimeStr(dataService.userPreferences?.end_minutes || 22 * 60)} onChange={(e) => { const v = timeStrToMinutes(e.target.value); dataService.updateUserPreferences({ end_minutes: v }); }} className="outline-none disabled:bg-gray-100 disabled:text-gray-400" disabled={dataService.hasAnyWeeks === true} />
                    </label>
                    <label className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2">
                      <span>Slot minutes</span>
                      <select aria-label="Slot minutes" value={dataService.userPreferences?.slot_minutes || 15} onChange={(e) => dataService.updateUserPreferences({ slot_minutes: Number(e.target.value) })} className="outline-none">{[15, 30, 60].map((n) => <option key={n} value={n}>{n}</option>)}</select>
                    </label>
                    <label className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2">
                      <span>Week starts on</span>
                      <select 
                        aria-label="Week starts on" 
                        value={dataService.userPreferences?.week_starts_on || "Monday"} 
                        onChange={async (e) => { 
                          const val = e.target.value as "Monday" | "Sunday"; 
                          const success = await dataService.updateUserPreferences({ week_starts_on: val }); 
                          if (success) {
                            setWeekStart(getWeekStart(new Date(weekStart), val)); 
                          } else {
                            console.error('Failed to update week_starts_on preference');
                          }
                        }} 
                        className="outline-none disabled:bg-gray-100 disabled:text-gray-400"
                        disabled={dataService.hasAnyWeeks === true}
                      >
                        <option>Monday</option>
                        <option>Sunday</option>
                      </select>
                    </label>
                    {dataService.hasAnyWeeks === true && (
                      <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-1">
                        <strong>Note:</strong> Start time, end time, and week start day cannot be changed when you have calendar entries. Clear all your calendar data to modify these settings.
                      </div>
                    )}
                    <label className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2">
                      <span>Max objectives</span>
                      <input aria-label="Maximum objectives" type="number" min={1} max={20} value={dataService.userPreferences?.max_objectives || 6} onChange={(e) => { const val = Math.max(1, Math.min(20, Number(e.target.value))); dataService.updateUserPreferences({ max_objectives: val }); }} className="w-20 text-right outline-none" />
                    </label>
                    <label className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2">
                      <span>Completion hatch</span>
                      <input
                        aria-label="Completion hatch color"
                        type="color"
                        value={dataService.userPreferences?.tick_color || '#16a34a'}
                        onChange={(e) => dataService.updateUserPreferences({ tick_color: e.target.value })}
                        className="h-8 w-12 p-0 border rounded"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2">
                      <span>Show objective names in cells</span>
                      <input
                        aria-label="Show objective names in cells"
                        type="checkbox"
                        checked={dataService.userPreferences?.show_objective_names || false}
                        onChange={(e) => dataService.updateUserPreferences({ show_objective_names: e.target.checked })}
                        className="h-4 w-4"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2">
                      <span>Prevent overwriting cells</span>
                      <input
                        aria-label="Prevent overwriting cells"
                        type="checkbox"
                        checked={dataService.userPreferences?.prevent_overwrite || false}
                        onChange={(e) => dataService.updateUserPreferences({ prevent_overwrite: e.target.checked })}
                        className="h-4 w-4"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 border rounded-xl px-3 py-2">
                      <span>Delete objectives</span>
                      <select
                        aria-label="Delete mode"
                        value={dataService.userPreferences?.delete_mode || "soft"}
                        onChange={(e) => dataService.updateUserPreferences({ delete_mode: e.target.value as "soft" | "hard" })}
                        className="outline-none"
                      >
                        <option value="soft">Archive (keep data)</option>
                        <option value="hard">Delete permanently</option>
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-col gap-2 text-sm">
                    {/* Updated styling to match Import JSON */}
                    <button onClick={exportData} className="btn-unstyled px-3 py-2 rounded-xl border cursor-pointer hover:bg-slate-100 text-center" aria-label="Export as JSON">Export JSON</button>
                    <label className="px-3 py-2 rounded-xl border cursor-pointer hover:bg-slate-100 text-center" title="Import from a JSON file">Import JSON
                      <input aria-label="Import JSON file" type="file" accept="application/json" onChange={(e) => (e.target.files && (e.target.files[0])) && importData(e.target.files[0])} className="hidden" />
                    </label>
                    <button 
                      onClick={async () => {
                        const newShowArchived = !dataService.userPreferences?.show_archived;
                        await dataService.updateUserPreferences({ show_archived: newShowArchived });
                        // Always load all objectives (including archived) so we don't lose data
                        await dataService.loadObjectives(true);
                      }}
                      className="btn-unstyled px-3 py-2 rounded-xl border cursor-pointer hover:bg-slate-100 text-center"
                      aria-label={dataService.userPreferences?.show_archived ? "Hide archived objectives" : "Show archived objectives"}
                    >
                      {dataService.userPreferences?.show_archived ? "Hide" : "Show"} Archive ({dataService.objectives.filter(o => o?.archived).length})
                    </button>
                  </div>

                  {dataService.userPreferences?.show_archived && (
                    <div className="space-y-2 mt-4 pt-4 border-t border-slate-200">
                      <div className="text-sm font-medium text-slate-700">Archived Objectives</div>
                      {dataService.objectives.filter(o => o?.archived).length > 0 ? (
                        dataService.objectives.filter(o => o?.archived).map((o) => (
                        <div key={o.id} className="flex items-center gap-3 p-2 pr-20 rounded-xl border border-slate-200 bg-slate-50 relative">
                          <div className="h-4 w-4 rounded-md border opacity-60" style={{ background: o.color }} />
                          <span className="flex-1 text-sm text-slate-600">{o.name}</span>
                          <button
                            onClick={() => deleteArchivedObjective(o)}
                            className="h-6 w-6 grid place-items-center rounded-md text-xs leading-none p-0 hover:bg-red-100 text-red-600 absolute right-8"
                            aria-label={`Delete ${o.name} permanently`} 
                            title="Delete permanently"
                          >
                            ×
                          </button>
                          <button
                            onClick={() => restoreObjective(o)}
                            className="h-6 w-6 grid place-items-center rounded-md text-xs leading-none p-0 hover:bg-slate-200 absolute right-2"
                            aria-label={`Restore ${o.name}`} 
                            title="Restore objective"
                          >
                            ↺
                          </button>
                        </div>
                        ))
                      ) : (
                        <div className="text-sm text-slate-500">No archived objectives</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation confirmation dialog */}
        {navigationConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md mx-4">
              <h3 className="text-lg font-semibold mb-3">Unsaved Changes</h3>
              <p className="text-gray-600 mb-6">{navigationConfirm.message}</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setNavigationConfirm(null)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    await manualSave(); // Save first
                    navigationConfirm.onConfirm(); // Then navigate
                  }}
                  className="px-4 py-2 bg-blue-500 text-white hover:bg-blue-600 rounded"
                >
                  Save & Continue
                </button>
                <button
                  onClick={navigationConfirm.onConfirm}
                  className="px-4 py-2 bg-red-500 text-white hover:bg-red-600 rounded"
                >
                  Discard Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toast */}
        {notice && (
          <div className="fixed bottom-4 right-4 bg-slate-900 text-white px-3 py-2 rounded-lg shadow" role="status" aria-live="polite">{notice}</div>
        )}
      </main>

      {/* Account Settings Modal */}
      {showAccountSettings && (
        <AccountSettings
          session={session}
          onClose={() => {
            setShowAccountSettings(false);
            // Reload current week data when returning from settings
            const weekISO = toISODate(weekStart);
            dataService.loadWeek(weekISO);
          }}
        />
      )}
    </div>
  );
}

/*********************** Dev Self-Tests ************************/
function runSelfTests() {
  try {
    let failures = 0;
    const assert = (cond: boolean, msg: string) => { if (!cond) { failures++; console.error("[TEST FAIL]", msg); } };

    const wed = new Date("2025-08-27T12:00:00");
    const monStart = getWeekStart(wed, "Monday");
    assert(monStart.getDay() === 1, "Week start (Monday) should be Monday (1)");
    const sunStart = getWeekStart(wed, "Sunday");
    assert(sunStart.getDay() === 0, "Week start (Sunday) should be Sunday (0)");

    const d0 = new Date(2025, 0, 15);
    const roundIso = toISODate(d0);
    const back = fromISODate(roundIso);
    assert(back.getFullYear() === 2025 && back.getMonth() === 0 && back.getDate() === 15, "ISO roundtrip should preserve Y-M-D");

    const t1 = "13:40";
    const m1 = timeStrToMinutes(t1);
    assert(minutesToTimeStr(m1) === t1, "minutes/time roundtrip");

    const f0 = formatTimeLabel(0);
    const f12 = formatTimeLabel(12 * 60);
    const f13 = formatTimeLabel(13 * 60);
    assert(f0.time.startsWith("12:") && f0.period === "AM", "formatTimeLabel 00:00 should be 12:xx AM");
    assert(f12.time.startsWith("12:") && f12.period === "PM", "formatTimeLabel 12:00 should be 12:xx PM");
    assert(f13.time.startsWith("1:") && f13.period === "PM", "formatTimeLabel 13:00 should be 1:xx PM");

    const objs = [ {id:"a", name:"A", color:"#000"}, {id:"b", name:"B", color:"#111"} ];
    const iso = toISODate(new Date(2025,0,1));
    const sched: AnyObj = { [iso]: { 0: {id:"a", completed:true}, 1: {id:"a", completed:false}, 2: {id:"b", completed:false} } };
    const stats = computeWeeklyStats(objs, [iso], sched, 30);
    const sa = stats.find(s=>s.id==='a')!; const sb = stats.find(s=>s.id==='b')!;
    assert(sa.slots === 2 && Math.abs(sa.hours - 1) < 1e-6, "Stats A hours/slots");
    assert(sb.slots === 1 && Math.abs(sb.hours - 0.5) < 1e-6, "Stats B hours/slots");

    const nextIso = toISODate(new Date(2025,0,2));
    const { overwrite } = buildCopyWeekPatch(sched, [iso,iso,iso,iso,iso,iso,iso], [nextIso,nextIso,nextIso,nextIso,nextIso,nextIso,nextIso], false);
    const copied = overwrite[nextIso];
    assert(copied && copied[0] && copied[0].completed === false, "Copy week should not carry ticks when false");

    const blocks = countWeekBlocks(sched, [iso]);
    assert(blocks === 3, "countWeekBlocks should count 3 blocks");

    const fri = new Date("2025-01-03T10:00:00");
    const monOfFri = getWeekStart(fri, "Monday");
    assert(monOfFri.getDay() === 1, "Friday weekStart(Monday) should be Monday");

    if (failures === 0) console.log("[Self-tests] All checks passed ✔");
  } catch (err) {
    console.warn("[Self-tests] Skipped due to error:", err);
  }
}

if (typeof window !== 'undefined') {
  setTimeout(runSelfTests, 0);
}
