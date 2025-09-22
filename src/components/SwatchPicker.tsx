import { useRef } from "react";

export const SWATCH_PALETTE = [
  // App default colors (from dataService.ts)
  "#1d4ed8", "#fb923c", "#22c55e",
  // Common reds
  "#ef4444", "#dc2626", "#991b1b",
  // Oranges and yellows
  "#f97316", "#f59e0b", "#eab308",
  // Greens
  "#16a34a", "#059669", "#047857",
  // Blues
  "#3b82f6", "#2563eb", "#1e40af",
  // Purples and pinks
  "#8b5cf6", "#a855f7", "#ec4899",
  // Teals and cyans
  "#14b8a6", "#06b6d4", "#0891b2",
  // Grays and neutrals
  "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827",
];

type Props = {
  value: string;
  onChange: (hex: string) => void;
  colors?: string[];
  columns?: number;
  showCustom?: boolean;  // optional "Custom…" fallback
  size?: number;         // trigger swatch size
  className?: string;
};

export default function SwatchPicker({
  value,
  onChange,
  colors = SWATCH_PALETTE,
  columns = 8,
  showCustom = false,
  size = 24,
  className = "",
}: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const close = () => { if (detailsRef.current) detailsRef.current.open = false; };
  const selected = (c: string) => c.toLowerCase() === (value || "").toLowerCase();

  return (
    <details ref={detailsRef} className={`relative inline-block ${className}`}>
      <summary
        className="list-none cursor-pointer block p-0 border rounded hover:shadow-md transition-shadow"
        style={{ width: size, height: size }}
        onKeyDown={(e) => { if (e.key === "Escape") close(); }}
      >
        <span className="sr-only">Choose colour</span>
        <div className="relative w-full h-full">
          <span
            aria-hidden
            className="block rounded w-full h-full"
            style={{ backgroundColor: value || "#ffffff" }}
            title={value}
          />
          <svg width="10" height="10" viewBox="0 0 20 20" aria-hidden className="absolute -right-1 -bottom-1 bg-white rounded-full border shadow-sm">
            <path d="M5 7l5 6 5-6" fill="currentColor" />
          </svg>
        </div>
      </summary>

      <div
        className="absolute z-[9999] mt-1 p-3 bg-white rounded-xl shadow-xl border min-w-max left-0 top-full"
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
      >
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              className={`btn-unstyled h-6 w-6 rounded outline-none focus:ring-2 ring-blue-500 ring-offset-1 transition-all hover:scale-110 border-0 p-0 ${
                selected(c) ? "ring-2 ring-blue-500 ring-offset-1 scale-110" : "ring-1 ring-gray-300"
              }`}
              style={{ backgroundColor: c }}
              aria-label={c}
              aria-pressed={selected(c)}
              onClick={() => { onChange(c); close(); }}
            />
          ))}
        </div>

        {showCustom && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-slate-500">Custom</span>
            <input
              type="color"
              value={value || "#ffffff"}
              onChange={(e) => onChange(e.target.value)}
              className="h-8 w-12 p-0 border rounded"
            />
          </div>
        )}
      </div>
    </details>
  );
}