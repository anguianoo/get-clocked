// Shared settings (used by the content script, background script and options page).
var CLOCKBAR_LAYOUTS = ["floating", "top", "bottom", "left", "right"];

var CLOCKBAR_DEFAULTS = {
  enabled: true,
  layout: "floating",     // "floating" | "top" | "bottom" | "left" | "right"
  align: "center",        // bars only: "start" | "center" | "end"
  floatX: 0.98,           // floating position, as a fraction of the free space (0 = left edge, 1 = right edge)
  floatY: 0.03,           // (0 = top edge, 1 = bottom edge)
  hour12: true,
  showSeconds: true,
  showDate: false,
  fontSize: 16,           // px
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  bold: false,
  textColor: "#ffffff",
  bgColor: "#1f2937",
  opacity: 90,            // 0-100
  pushContent: false      // bars only: move page content so the bar doesn't cover it
};

// Fills in defaults and upgrades values saved by version 1.0.
function clockbarNormalize(stored) {
  const s = { ...CLOCKBAR_DEFAULTS, ...stored };
  if (!CLOCKBAR_LAYOUTS.includes(s.layout)) s.layout = CLOCKBAR_DEFAULTS.layout;
  if (s.align === "left") s.align = "start";
  if (s.align === "right") s.align = "end";
  if (!["start", "center", "end"].includes(s.align)) s.align = "center";
  return s;
}
