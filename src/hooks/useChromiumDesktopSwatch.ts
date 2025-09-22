export function useChromiumDesktopSwatch() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMacSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua);
  const isChromium = /Chrome|Chromium|Edg\//i.test(ua);
  const hasFinePointer =
    typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches;

  // Use our swatch grid on Chromium desktop only; keep native everywhere else
  return !isIOS && !isAndroid && !isMacSafari && isChromium && hasFinePointer;
}