// Category management

const CATS_URL = "categories.json";
const defaultCategories = [
  "Productivity & Focus",
  "Digital Wellbeing",
  "Investing",
  "Habits",
  "Use Cases",
  "Announcements",
];

export async function loadCategories() {
  try {
    const res = await fetch(CATS_URL, { cache: "no-cache" });
    const data = res.ok ? await res.json() : defaultCategories;
    const names = Array.isArray(data)
      ? data.map((c) =>
          typeof c === "string" ? c : (c && (c.name || c.title)) || ""
        )
      : defaultCategories;

    const seen = new Set();
    const deduped = names
      .map((s) => (s || "").trim())
      .filter((s) => s && !seen.has(s) && seen.add(s));

    const dl = document.getElementById("hb-categories");
    dl.innerHTML = "";
    deduped.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      dl.appendChild(opt);
    });
  } catch {
    // fallback to defaults
    const dl = document.getElementById("hb-categories");
    dl.innerHTML = "";
    defaultCategories.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      dl.appendChild(opt);
    });
  }
}

export function setupCategoryValidation(categoryEl, status) {
  categoryEl.addEventListener("blur", () => {
    const val = (categoryEl.value || "").trim();
    const options = Array.from(
      document.getElementById("hb-categories").options
    ).map((o) => o.value);
    if (val && !options.includes(val)) {
      status.innerHTML =
        '<span class="muted">Tip: that category isn\'t in your list — update <code>categories.json</code> or pick an existing one.</span>';
    }
  });
}
