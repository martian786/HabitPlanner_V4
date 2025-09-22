// import { StrictMode } from 'react'
// import { createRoot } from 'react-dom/client'
// import './index.css'
// import App from './App.tsx'
// import "./index.css"; // <-- this line is essential

// createRoot(document.getElementById('root')!).render(
//   <StrictMode>
//     <App />
//   </StrictMode>,
// )

import React, { Suspense, lazy, useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { supabase } from "./lib/supabase";
import type { UserPreferences } from "./lib/dataService";
import "./index.css";

// Lazy load the Analytics page to reduce initial bundle size
const Analytics = lazy(() => import("./Analytics"));

// Analytics wrapper that fetches user preferences
export function AnalyticsWithPreferences() {
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data, error } = await supabase
            .from('user_preferences')
            .select('*')
            .eq('user_id', session.user.id)
            .maybeSingle();

          if (error) {
            console.error('Error fetching preferences:', error);
          }

          setUserPreferences(data); // data will be null for new users, object for existing
        }
      } catch (error) {
        console.error('Error fetching preferences:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPreferences();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-slate-50 grid place-items-center">
        <div className="text-center">
          <div className="h-8 w-8 rounded-xl bg-slate-900 text-white grid place-items-center font-bold mx-auto mb-2">AN</div>
          <div className="text-slate-600">Loading Analytics...</div>
        </div>
      </div>
    );
  }

  return (
    <Analytics 
      settings={{
        weekStartsOn: userPreferences?.week_starts_on || "Monday",
        slotMinutes: userPreferences?.slot_minutes || 30,
        startMinutes: userPreferences?.start_minutes || 6 * 60,
        endMinutes: userPreferences?.end_minutes || 22 * 60,
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route
            path="/analytics"
            element={
              <Suspense fallback={
                <div className="min-h-screen w-full bg-slate-50 grid place-items-center">
                  <div className="text-center">
                    <div className="h-8 w-8 rounded-xl bg-slate-900 text-white grid place-items-center font-bold mx-auto mb-2">AN</div>
                    <div className="text-slate-600">Loading Analytics...</div>
                  </div>
                </div>
              }>
                <AnalyticsWithPreferences />
              </Suspense>
            }
          />
          <Route path="*" element={<App />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
