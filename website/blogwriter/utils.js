// Utility functions for blogwriter

export function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export function esc(s) {
  return (s || "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

export function isValidDate(y) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(y)) return false;
  const [Y, M, D] = y.split("-").map(Number);
  const dt = new Date(Date.UTC(Y, M - 1, D));
  return (
    dt.getUTCFullYear() === Y &&
    dt.getUTCMonth() === M - 1 &&
    dt.getUTCDate() === D
  );
}

export function setToday(dateEl) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  dateEl.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function estimateReadMinutesFromMarkdown(mdText) {
  const text = (mdText || "")
    .replace(/[#>*_`~\-+\[\]\(\)!>|]/g, " ")
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text ? text.split(" ").length : 0;
  const mins = Math.max(1, Math.round(words / 225));
  return mins;
}

export function makeId() {
  return window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function setButtonState(btn, disabled) {
  btn.disabled = !!disabled;
  btn.setAttribute("aria-disabled", disabled ? "true" : "false");
}
