import { useMemo, useState, useEffect } from "react";
import type { CSSProperties } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
  Cell,
} from "recharts";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import habitblockLogo from "./assets/habitblock-logo.png";

/*************************************************
 * Analytics Page (Week / Month / Year)
 * - Visualize planned vs actual (completed) time per objective
 * - Pulls data from Supabase (weeks + objectives) for the selected period
 *   and falls back to localStorage if not signed in
 * - Uses Tailwind for layout and Recharts for graphs
 *************************************************/

/*** Types shared with your app ***/
type Objective = { id: string; name: string; color: string; archived?: boolean };
type Entry = { id: string; completed: boolean } | string; // keep back-compat with string id

type Schedule = Record<string, Record<string | number, Entry>>; // { [isoDate]: { [slotIndex]: Entry } }

type Settings = {
  startMinutes: number;
  endMinutes: number;
  slotMinutes: number;
  weekStartsOn: "Monday" | "Sunday";
};

/*** SaaS Analytics - Database-only for security ***/

/*** Date helpers ***/
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function getWeekStart(date: Date, weekStartsOn: "Monday" | "Sunday" = "Monday") {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun - 6 Sat
  const startIndex = weekStartsOn === "Sunday" ? 0 : 1; // Monday=1
  const diff = (day - startIndex + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}

function monthStart(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1); x.setHours(0,0,0,0); return x;
}
function nextMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}
function yearStart(d: Date) {
  const x = new Date(d.getFullYear(), 0, 1); x.setHours(0,0,0,0); return x;
}
function nextYear(d: Date) {
  return new Date(d.getFullYear() + 1, 0, 1);
}

/*** Analytics helpers ***/
function norm(entry: Entry | undefined | null): { id: string; completed: boolean } | null {
  if (!entry) return null;
  if (typeof entry === "string") return { id: entry, completed: false };
  return { id: (entry as { id: string }).id, completed: !!(entry as { completed?: boolean }).completed };
}

function daysBetween(start: Date, endExclusive: Date): string[] {
  const out: string[] = [];
  for (let d = new Date(start); d < endExclusive; d.setDate(d.getDate() + 1)) {
    out.push(toISODate(d));
  }
  return out;
}

function aggregateForRange(
  objectives: Objective[],
  schedule: Schedule,
  daysISO: string[],
  slotMinutes: number
) {
  const plannedSlots: Record<string, number> = {};
  const doneSlots: Record<string, number> = {};

  for (const iso of daysISO) {
    const day = schedule[iso];
    if (!day) continue;
    for (const k in day) {
      const e = norm(day[k]);
      if (!e) continue;
      if (!plannedSlots[e.id]) plannedSlots[e.id] = 0;
      if (!doneSlots[e.id]) doneSlots[e.id] = 0;
      plannedSlots[e.id] += 1;
      if (e.completed) doneSlots[e.id] += 1;
    }
  }

  const rows = objectives.map((o) => {
    const planned = plannedSlots[o.id] ?? 0;
    const done = doneSlots[o.id] ?? 0;
    const plannedH = (planned * slotMinutes) / 60;
    const doneH = (done * slotMinutes) / 60;
    const pct = planned ? (done / planned) * 100 : 0;
    return {
      id: o.id,
      name: o.name,
      color: o.color,
      plannedSlots: planned,
      doneSlots: done,
      plannedHours: plannedH,
      doneHours: doneH,
      percent: pct,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.plannedSlots += r.plannedSlots;
      acc.doneSlots += r.doneSlots;
      acc.plannedHours += r.plannedHours;
      acc.doneHours += r.doneHours;
      return acc;
    },
    { plannedSlots: 0, doneSlots: 0, plannedHours: 0, doneHours: 0 }
  );
  const overallPct = totals.plannedSlots
    ? (totals.doneSlots / totals.plannedSlots) * 100
    : 0;

  return { rows, totals: { ...totals, overallPct } };
}

function dailySeries(
  objectives: Objective[],
  schedule: Schedule,
  daysISO: string[],
  slotMinutes: number
) {
  // Create a set of valid objective IDs for quick lookup
  const validObjectiveIds = new Set(objectives.map(o => o.id));
  
  // Returns [{ date, plannedHours, doneHours }]
  return daysISO.map((iso) => {
    const day = schedule[iso];
    let planned = 0;
    let done = 0;
    if (day) {
      for (const k in day) {
        const e = norm(day[k]);
        if (!e) continue;
        // Only count if this entry belongs to a valid (non-archived) objective
        if (!validObjectiveIds.has(e.id)) continue;
        planned += 1;
        if (e.completed) done += 1;
      }
    }
    return {
      date: iso.slice(5), // MM-DD for compact axis
      plannedHours: (planned * slotMinutes) / 60,
      doneHours: (done * slotMinutes) / 60,
    };
  });
}

/*** Main component ***/
export default function Analytics(props: {
  // If you want to force local data, pass `useLocalOnly`.
  useLocalOnly?: boolean;
  settings?: Partial<Settings>;
}) {
  /*** Settings ***/
  const slotMinutes = props.settings?.slotMinutes ?? 20;
  const weekStartsOn = (props.settings?.weekStartsOn ?? "Monday") as "Monday" | "Sunday";

  type Period = "week" | "month" | "year";
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState<Date>(new Date());

  /*** Auth & DB data ***/
  const [session, setSession] = useState<Session | null>(null);
  const [dbObjectives, setDbObjectives] = useState<Objective[]>([]);
  const [dbSchedule, setDbSchedule] = useState<Schedule>({});
  const [loading, setLoading] = useState<boolean>(!props.useLocalOnly);
  const [error, setError] = useState<string | null>(null);
  const [userPreferences, setUserPreferences] = useState<{ show_archived: boolean; delete_mode: "soft" | "hard" }>({ show_archived: false, delete_mode: "soft" });

  // Load session
  useEffect(() => {
    if (props.useLocalOnly) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [props.useLocalOnly]);

  // Fetch user preferences
  useEffect(() => {
    (async () => {
      if (props.useLocalOnly || !session?.user?.id) return;
      try {
        const { data, error } = await supabase
          .from("user_preferences")
          .select("show_archived,delete_mode")
          .eq("user_id", session.user.id)
          .maybeSingle();
          
        if (error) {
          console.error("Error fetching preferences:", error);
          return;
        }
        
        if (data) {
          setUserPreferences(data);
        }
        // If no data, keep default preferences
      } catch (err: unknown) {
        console.error("Failed to load user preferences:", err);
      }
    })();
  }, [session?.user?.id, props.useLocalOnly]);

  // Compute period window
  const { start, end, label } = useMemo(() => {
    if (period === "week") {
      const s = getWeekStart(anchor, weekStartsOn);
      const e = addDays(s, 7);
      const rangeLabel = `${s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(e, -1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      return { start: s, end: e, label: rangeLabel };
    }
    if (period === "month") {
      const s = monthStart(anchor);
      const e = nextMonth(s);
      const rangeLabel = s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      return { start: s, end: e, label: rangeLabel };
    }
    // year
    const s = yearStart(anchor);
    const e = nextYear(s);
    const rangeLabel = s.getFullYear().toString();
    return { start: s, end: e, label: rangeLabel };
  }, [anchor, period, weekStartsOn]);

  // Fetch objectives once (or on session/preferences change)
  useEffect(() => {
    (async () => {
      if (props.useLocalOnly || !session?.user) return;
      try {
        let query = supabase
          .from("objectives")
          .select("id,name,color,archived")
          .eq("user_id", session.user.id);
        
        // Only filter out archived objectives if user preference is to hide them
        if (!userPreferences.show_archived) {
          query = query.or("archived.is.null,archived.eq.false");
        }
        
        const { data, error } = await query.order("sort_order", { ascending: true });
        if (error) throw error;
        setDbObjectives((data ?? []) as Objective[]);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load objectives");
      }
    })();
  }, [session?.user?.id, session?.user, props.useLocalOnly, userPreferences.show_archived]);

  // Compute period window first to avoid complex expressions in dependencies
  const startTime = useMemo(() => start.getTime(), [start]);
  const endTime = useMemo(() => end.getTime(), [end]);
  const userId = session?.user?.id;

  // Fetch weeks for the current period window
  useEffect(() => {
    (async () => {
      if (props.useLocalOnly || !session?.user || !userId) return;
      setLoading(true);
      setError(null);
      try {
        // Align the window to weeks so we fetch all intersecting rows
        const firstWeek = getWeekStart(start, weekStartsOn);
        const lastWeek = getWeekStart(addDays(end, -1), weekStartsOn);

        const { data, error } = await supabase
          .from("weeks")
          .select("week_start,schedule")
          .eq("user_id", userId)
          .gte("week_start", toISODate(firstWeek))
          .lte("week_start", toISODate(lastWeek));
        if (error) throw error;

        // Merge all week schedules into a single schedule map for the charts
        const merged: Schedule = {};
        (data ?? []).forEach((row: { week_start: string; schedule: unknown }) => {
          const sched = row.schedule as Schedule | Record<string, unknown> | null;
          if (!sched) return;
          for (const iso in sched) {
            const day = (sched as Record<string, Record<string, Entry>>)[iso];
            if (!merged[iso]) merged[iso] = {};
            for (const idx in day) {
              (merged[iso] as Record<string, Entry>)[idx] = day[idx];
            }
          }
        });
        setDbSchedule(merged);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load weeks");
      } finally {
        setLoading(false);
      }
    })();
  }, [userId, startTime, endTime, weekStartsOn, props.useLocalOnly, start, end, session?.user]);

  /*** Data sources (Database-only for authenticated users - SaaS security best practice) ***/
  // For SaaS applications, we only use database data for authenticated users
  const objectives: Objective[] = useMemo(() => 
    session && !props.useLocalOnly ? dbObjectives : []
  , [session, props.useLocalOnly, dbObjectives]);
  
  const schedule: Schedule = useMemo(() => 
    session && !props.useLocalOnly ? dbSchedule : {}
  , [session, props.useLocalOnly, dbSchedule]);

  // Check if we have meaningful data
  const hasDbData = dbObjectives.length > 0 || Object.keys(dbSchedule).length > 0;
  const dataSource = session && !props.useLocalOnly 
    ? (hasDbData ? "Database" : "Database (no data)")
    : "Sign in required";

  /*** Aggregations ***/
  const daysISO = useMemo(() => daysBetween(start, end), [start, end]);
  const { rows, totals } = useMemo(
    () => aggregateForRange(objectives, schedule, daysISO, slotMinutes),
    [objectives, schedule, daysISO, slotMinutes]
  );
  const series = useMemo(
    () => dailySeries(objectives, schedule, daysISO, slotMinutes),
    [objectives, schedule, daysISO, slotMinutes]
  );

  function shift(n: number) {
    if (period === "week") setAnchor(addDays(anchor, 7 * n));
    else if (period === "month") setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + n, 1));
    else setAnchor(new Date(anchor.getFullYear() + n, 0, 1));
  }

  const formatHours = (h: number) => `${h.toFixed(1)}h`;
  const pct = (p: number) => `${Math.round(p)}%`;

  // Show sign-in requirement for unauthenticated users
  if (!session) {
    return (
      <div className="min-h-screen w-full bg-slate-50 text-slate-900 flex items-center justify-center">
        <div className="max-w-md mx-auto p-8 bg-white rounded-2xl shadow-lg text-center">
          <img src={habitblockLogo} alt="Habitblock" className="h-8 w-auto mx-auto mb-4" />
          <h1 className="text-2xl font-semibold mb-2">Habitblock Analytics</h1>
          <p className="text-slate-600 mb-6">Sign in to view your time tracking analytics and insights.</p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            ← Back to Planner
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <img src={habitblockLogo} alt="Habitblock" className="h-8 w-auto" />
              <div>
                <h1 className="text-xl font-semibold leading-tight">Habitblock Analytics</h1>
                <p className="text-xs text-slate-500">Planned vs actual by week, month, year</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href="/"
                className="px-3 py-1.5 rounded-lg border hover:bg-slate-100 text-sm"
                aria-label="Back to planner"
              >
                ← Back to Planner
              </a>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
                className="px-3 py-1.5 rounded-lg border"
                aria-label="Period"
              >
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
              <div className="flex items-center gap-2">
                <button onClick={() => shift(-1)} className="px-3 py-1.5 rounded-lg border hover:bg-slate-100">◀</button>
                <div className="relative">
                  <button
                    onClick={() => {
                      const input = document.getElementById('analytics-date-picker') as HTMLInputElement;
                      if (input) input.showPicker();
                    }}
                    className="text-sm text-slate-700 min-w-[10ch] text-center px-2 py-1 rounded hover:bg-slate-100 transition-colors cursor-pointer"
                    aria-label="Select date to jump to"
                    title="Click to select a date"
                  >
                    {label}
                  </button>
                  <input
                    id="analytics-date-picker"
                    aria-label="Jump to date"
                    type="date"
                    value={toISODate(anchor)}
                    onChange={(e) => {
                      const selectedDate = new Date(e.target.value);
                      setAnchor(selectedDate);
                    }}
                    className="absolute opacity-0 pointer-events-none"
                  />
                </div>
                <button onClick={() => shift(1)} className="px-3 py-1.5 rounded-lg border hover:bg-slate-100">▶</button>
              </div>
              <button onClick={() => setAnchor(new Date())} className="px-3 py-1.5 rounded-lg border hover:bg-slate-100">This {period}</button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 grid grid-cols-12 gap-4">
        {/* Alerts */}
        {error && (
          <div className="col-span-12">
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="col-span-12">
          <section className="bg-white rounded-2xl shadow p-4">
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <div className="text-sm text-slate-600">
                Time unit: <b>{slotMinutes}</b> min slots
                <span className="ml-2 text-slate-400">
                  Source: {dataSource}
                  {loading ? " (loading…)" : ""}
                </span>
              </div>
              <div className="flex gap-2">
                <div className="rounded-xl border px-3 py-2 text-sm">
                  <div className="text-slate-500">Planned</div>
                  <div className="font-semibold tabular-nums">{formatHours(totals.plannedHours)}</div>
                </div>
                <div className="rounded-xl border px-3 py-2 text-sm">
                  <div className="text-slate-500">Actual</div>
                  <div className="font-semibold tabular-nums">{formatHours(totals.doneHours)}</div>
                </div>
                <div className="rounded-xl border px-3 py-2 text-sm">
                  <div className="text-slate-500">Completion</div>
                  <div className="font-semibold tabular-nums">{pct(totals.overallPct)}</div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Chart: by objective */}
        <section className="col-span-12 lg:col-span-7">
          <section className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold mb-3">Planned vs Actual by Objective</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows.map(r => ({
                  name: r.name,
                  planned: r.plannedHours,
                  actual: r.doneHours,
                  color: r.color,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" interval={0} tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => `${v}h`} />
                  <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)}h`} />
                  <Legend />
                  <Bar dataKey="planned" name="Planned">
                    {rows.map((r, i) => (
                      <Cell key={`p-${i}`} fill={r.color + "66"} />
                    ))}
                  </Bar>
                  <Bar dataKey="actual" name="Actual">
                    {rows.map((r, i) => (
                      <Cell key={`a-${i}`} fill={r.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </section>

        {/* Chart: daily trend */}
        <section className="col-span-12 lg:col-span-5">
          <section className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold mb-3">{`Daily Trend (${period})`}</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => `${v}h`} />
                  <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)}h`} />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="plannedHours" 
                    name="Planned" 
                    stroke="#2563eb"
                    strokeWidth={3}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="doneHours" 
                    name="Actual" 
                    stroke="#dc2626"
                    strokeWidth={3}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </section>

        {/* Table */}
        <section className="col-span-12">
          <section className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold mb-3">Details</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left py-2 px-2">Objective</th>
                    <th className="text-right py-2 px-2">Planned (h)</th>
                    <th className="text-right py-2 px-2">Actual (h)</th>
                    <th className="text-right py-2 px-2">Diff (h)</th>
                    <th className="text-right py-2 px-2">% Done</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const diff = r.doneHours - r.plannedHours;
                    const diffStr = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}h`;
                    const color: CSSProperties["color"] = diff >= 0 ? "#166534" : "#991b1b"; // green-700 / red-800
                    return (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: r.color }} />
                            <span>{r.name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">{r.plannedHours.toFixed(1)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{r.doneHours.toFixed(1)}</td>
                        <td className="py-2 px-2 text-right tabular-nums" style={{ color }}>{diffStr}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{Math.round(r.percent)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}

/*************************************************
 * Notes
 * - Ensure your DB has tables: `weeks(user_id uuid, week_start date/text, schedule jsonb)`
 *   and `objectives(user_id uuid, id uuid/uuidv7, name text, color text, sort_order int)` with RLS.
 * - Page prefers Supabase data when signed in; otherwise falls back to localStorage.
 * - Route example: <Route path="/analytics" element={<Analytics />} />
 * - Install charts: `npm i recharts`
 *************************************************/
