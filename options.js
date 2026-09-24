const form = document.getElementById("settings");
const preview = document.getElementById("preview");
const previewClock = document.getElementById("preview-clock");
const statusEl = document.getElementById("status");
let current = clockbarNormalize({});
const pending = {};
let writeTimer, statusTimer;

// ---------- Form <-> settings ----------
function fillForm(s) {
  const focused = document.activeElement;
  for (const el of form.elements) {
    if (!el.name || !(el.name in s)) continue;
    if (el === focused && (el.type === "range" || el.type === "color")) continue;
    if (el.type === "checkbox") el.checked = Boolean(s[el.name]);
    else el.value = s[el.name];
  }
  updateOutputs();
  updateVisibleRows();
}

function readField(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "range") return Number(el.value);
  return el.value;
}

function updateOutputs() {
  document.getElementById("fontSize-out").textContent = `${current.fontSize}px`;
  document.getElementById("opacity-out").textContent = `${current.opacity}%`;
}

function updateVisibleRows() {
  const isFloating = current.layout === "floating";
  for (const row of form.querySelectorAll('[data-for="floating"]')) row.hidden = !isFloating;
  for (const row of form.querySelectorAll('[data-for="bar"]')) row.hidden = isFloating;
}

function flashStatus(text) {
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.textContent = ""), 1500);
}

// Apply immediately, write to storage shortly after (avoids a write per slider step).
function save(changes, delay = 250) {
  Object.assign(current, changes);
  Object.assign(pending, changes);
  updateOutputs();
  updateVisibleRows();
  renderPreview();
  clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    const batch = { ...pending };
    for (const k of Object.keys(pending)) delete pending[k];
    await browser.storage.sync.set(batch);
    flashStatus("Saved");
  }, delay);
}

form.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.name) return;
  save({ [el.name]: readField(el) }, el.type === "range" || el.type === "color" ? 300 : 0);
});

document.getElementById("reset-pos").addEventListener("click", () => {
  save({ floatX: CLOCKBAR_DEFAULTS.floatX, floatY: CLOCKBAR_DEFAULTS.floatY }, 0);
});

document.getElementById("reset").addEventListener("click", async () => {
  clearTimeout(writeTimer);
  for (const k of Object.keys(pending)) delete pending[k];
  await browser.storage.sync.clear();
  current = clockbarNormalize({});
  fillForm(current);
  renderPreview();
  flashStatus("Reset to defaults");
});

// Stay in sync with changes made on pages (dragging, the quick panel, the shortcut).
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const next = { ...current };
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in pending) continue;
    next[key] = newValue === undefined ? CLOCKBAR_DEFAULTS[key] : newValue;
  }
  current = clockbarNormalize(next);
  fillForm(current);
  renderPreview();
});

// ---------- Preview ----------
function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = parseInt(m ? m[1] : "000000", 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function renderPreview() {
  const s = current;
  const c = previewClock;
  c.className = `clock ${s.layout}` + (s.enabled ? "" : " off");
  c.style.cssText = "";
  c.style.background = hexToRgba(s.bgColor, s.opacity / 100);
  c.style.color = s.textColor;
  c.style.fontFamily = s.fontFamily;
  c.style.fontSize = `${s.fontSize}px`;
  c.style.fontWeight = s.bold ? 700 : 400;
  if (s.layout !== "floating") {
    c.style.justifyContent = { start: "flex-start", center: "center", end: "flex-end" }[s.align];
  }
  tickPreview();
}

function placePreviewFloating() {
  if (current.layout !== "floating") return;
  const maxX = Math.max(0, preview.clientWidth - previewClock.offsetWidth);
  const maxY = Math.max(0, preview.clientHeight - previewClock.offsetHeight);
  previewClock.style.left = `${current.floatX * maxX}px`;
  previewClock.style.top = `${current.floatY * maxY}px`;
}

function tickPreview() {
  const now = new Date();
  previewClock.querySelector(".time").textContent = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: current.showSeconds ? "2-digit" : undefined,
    hour12: current.hour12
  });
  const dateEl = previewClock.querySelector(".date");
  dateEl.hidden = !current.showDate;
  dateEl.textContent = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  placePreviewFloating();
}

setInterval(tickPreview, 1000);
window.addEventListener("resize", placePreviewFloating);

// ---------- Init ----------
browser.storage.sync.get(CLOCKBAR_DEFAULTS).then((stored) => {
  current = clockbarNormalize(stored);
  fillForm(current);
  renderPreview();
});
