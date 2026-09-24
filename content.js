(() => {
  // Only run in the top-level page (not iframes), and only once.
  if (window.top !== window.self) return;
  if (document.getElementById("clockbar-ext-host")) return;

  let s = clockbarNormalize({});
  let host, shadow, styleEl, clock, timeEl, dateEl, gearBtn, panel, timerId;
  let hiddenOnPage = false;
  let panelOpen = false;
  let drag = null;

  const html = document.documentElement;
  const savedMargin = { prop: null, value: "", priority: "" };
  const pending = {};
  let writeTimer;

  // ---------------------------------------------------------------- helpers
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    const n = parseInt(m ? m[1] : "000000", 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function viewport() {
    return {
      w: Math.min(window.innerWidth, html.clientWidth || window.innerWidth),
      h: window.innerHeight
    };
  }

  // Apply a change right away on this page, then write it to storage
  // (debounced so dragging a slider doesn't flood storage with writes).
  function save(changes, delay = 250) {
    Object.assign(s, changes);
    Object.assign(pending, changes);
    render();
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      const batch = { ...pending };
      for (const k of Object.keys(pending)) delete pending[k];
      browser.storage.sync.set(batch);
    }, delay);
  }

  // ---------------------------------------------------------------- static CSS
  const BASE_CSS = `
    :host { all: initial; }
    [hidden] { display: none !important; }

    .clock {
      position: fixed;
      z-index: 2147483646;
      box-sizing: border-box;
      display: flex;
      align-items: baseline;
      gap: 0.6em;
      line-height: 1.3;
      letter-spacing: 0.01em;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      user-select: none;
      -moz-user-select: none;
    }
    .clock .date { opacity: 0.75; font-size: 0.8em; }

    .clock.floating { cursor: grab; touch-action: none; }
    .clock.floating.dragging { cursor: grabbing; }
    .clock.left, .clock.right { flex-direction: column; align-items: center; gap: 0.2em; }

    .gear {
      position: absolute;
      width: 22px; height: 22px;
      padding: 0; margin: 0;
      border: none; border-radius: 50%;
      display: grid; place-items: center;
      background: rgba(20, 24, 28, 0.75);
      color: #fff;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .gear svg { width: 14px; height: 14px; display: block; }
    .clock:hover .gear, .gear:focus-visible, .clock.panel-open .gear { opacity: 1; }
    .clock.dragging .gear { opacity: 0; }
    .clock.floating .gear { top: -9px; right: -9px; }
    .clock.top .gear, .clock.bottom .gear { right: 10px; top: 50%; margin-top: -11px; }
    .clock.left .gear, .clock.right .gear { bottom: 10px; left: 50%; margin-left: -11px; }

    .panel {
      --bg: #ffffff; --ink: #1a2321; --muted: #5d6b68; --line: #d8e0de; --accent: #0f766e; --field: #f3f6f5;
      position: fixed;
      z-index: 2147483647;
      width: 268px;
      box-sizing: border-box;
      padding: 12px 14px 14px;
      background: var(--bg);
      color: var(--ink);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      text-align: left;
    }
    @media (prefers-color-scheme: dark) {
      .panel { --bg: #1d2524; --ink: #e4ebe9; --muted: #98a8a5; --line: #34403e; --accent: #2dd4bf; --field: #262f2e; }
    }
    .panel * { box-sizing: border-box; font: inherit; color: inherit; }
    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .head strong { font-weight: 650; font-size: 14px; }
    .x { border: none; background: none; font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 4px; color: var(--muted); }
    .x:hover { color: var(--ink); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; }
    .row output { color: var(--muted); margin-left: 4px; }
    .row select { width: 150px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); }
    .row input[type="range"] { width: 120px; accent-color: var(--accent); }
    .row input[type="color"] { width: 40px; height: 26px; padding: 1px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); cursor: pointer; }
    .checks { display: flex; gap: 12px; padding: 8px 0 4px; border-top: 1px solid var(--line); margin-top: 4px; }
    .checks label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
    .checks input { accent-color: var(--accent); margin: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .actions button {
      padding: 5px 9px; border: 1px solid var(--line); border-radius: 6px;
      background: var(--field); cursor: pointer; font-size: 12px;
    }
    .actions button:hover { border-color: var(--accent); }
    .actions .more { margin-left: auto; color: var(--accent); }
    .panel :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  `;

  const PANEL_HTML = `
    <div class="head">
      <strong>Clock preferences</strong>
      <button type="button" class="x" data-act="close" aria-label="Close">×</button>
    </div>
    <label class="row"><span>Style</span>
      <select data-key="layout">
        <option value="floating">Floating (drag it)</option>
        <option value="top">Top bar</option>
        <option value="bottom">Bottom bar</option>
        <option value="left">Left side bar</option>
        <option value="right">Right side bar</option>
      </select>
    </label>
    <label class="row"><span>Text size<output data-out="fontSize"></output></span>
      <input type="range" data-key="fontSize" min="10" max="40" step="1">
    </label>
    <label class="row"><span>Text color</span><input type="color" data-key="textColor"></label>
    <label class="row"><span>Background</span><input type="color" data-key="bgColor"></label>
    <label class="row"><span>Opacity<output data-out="opacity"></output></span>
      <input type="range" data-key="opacity" min="0" max="100" step="5">
    </label>
    <div class="checks">
      <label><input type="checkbox" data-key="hour12">12-hour</label>
      <label><input type="checkbox" data-key="showSeconds">Seconds</label>
      <label><input type="checkbox" data-key="showDate">Date</label>
    </div>
    <div class="actions">
      <button type="button" data-act="resetPos">Reset position</button>
      <button type="button" data-act="hide">Hide on this page</button>
      <button type="button" class="more" data-act="more">All settings</button>
    </div>
  `;

  // ---------------------------------------------------------------- build
  function makeGearIcon() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.2");
    svg.setAttribute("stroke-linecap", "round");
    const circle = document.createElementNS(NS, "circle");
    circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "3.2");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1");
    svg.append(circle, path);
    return svg;
  }

  function build() {
    host = document.createElement("div");
    host.id = "clockbar-ext-host";
    shadow = host.attachShadow({ mode: "closed" });

    const base = document.createElement("style");
    base.textContent = BASE_CSS;
    styleEl = document.createElement("style");

    clock = document.createElement("div");
    clock.title = "Drag to move · right-click for preferences";
    timeEl = document.createElement("span");
    timeEl.className = "time";
    dateEl = document.createElement("span");
    dateEl.className = "date";
    gearBtn = document.createElement("button");
    gearBtn.type = "button";
    gearBtn.className = "gear";
    gearBtn.title = "Clock preferences";
    gearBtn.setAttribute("aria-label", "Clock preferences");
    gearBtn.append(makeGearIcon());
    clock.append(timeEl, dateEl, gearBtn);

    panel = document.createElement("div");
    panel.className = "panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Clock preferences");
    panel.innerHTML = PANEL_HTML; // static markup, no page or user data

    shadow.append(base, styleEl, clock, panel);
    html.appendChild(host);

    wireClock();
    wirePanel();
  }

  // ---------------------------------------------------------------- clock look
  function clockCss() {
    const bg = hexToRgba(s.bgColor, clamp(s.opacity, 0, 100) / 100);
    const justify = { start: "flex-start", center: "center", end: "flex-end" }[s.align];
    let place;
    switch (s.layout) {
      case "top":
        place = `top:0; left:0; right:0; justify-content:${justify}; padding:4px 40px;`;
        break;
      case "bottom":
        place = `bottom:0; left:0; right:0; justify-content:${justify}; padding:4px 40px;`;
        break;
      case "left":
        place = `top:0; bottom:0; left:0; justify-content:${justify}; padding:40px 10px;`;
        break;
      case "right":
        place = `top:0; bottom:0; right:0; justify-content:${justify}; padding:40px 10px;`;
        break;
      default: // floating
        place = `padding:6px 14px; border-radius:999px; box-shadow:0 3px 14px rgba(0,0,0,.28);`;
    }
    return `.clock {
      ${place}
      background: ${bg};
      color: ${s.textColor};
      font-family: ${s.fontFamily};
      font-size: ${Number(s.fontSize) || 16}px;
      font-weight: ${s.bold ? 700 : 400};
    }`;
  }

  function placeFloating() {
    if (s.layout !== "floating" || drag) return;
    const { w, h } = viewport();
    const maxX = Math.max(0, w - clock.offsetWidth);
    const maxY = Math.max(0, h - clock.offsetHeight);
    clock.style.left = `${clamp(s.floatX, 0, 1) * maxX}px`;
    clock.style.top = `${clamp(s.floatY, 0, 1) * maxY}px`;
  }

  function tick() {
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: s.showSeconds ? "2-digit" : undefined,
      hour12: s.hour12
    });
    if (s.showDate) {
      dateEl.textContent = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    }
    placeFloating(); // width can change (e.g. 9:59 -> 10:00), keep it inside the window
  }

  function startTimer() {
    stopTimer();
    const loop = () => {
      tick();
      timerId = setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
    };
    timerId = setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
  }

  function stopTimer() {
    clearTimeout(timerId);
    timerId = null;
  }

  // ---------------------------------------------------------------- push page content (bars)
  function restoreMargin() {
    if (!savedMargin.prop) return;
    if (savedMargin.value) html.style.setProperty(savedMargin.prop, savedMargin.value, savedMargin.priority);
    else html.style.removeProperty(savedMargin.prop);
    savedMargin.prop = null;
  }

  function applyPush(on) {
    restoreMargin();
    if (!on) return;
    const prop = { top: "margin-top", bottom: "margin-bottom", left: "margin-left", right: "margin-right" }[s.layout];
    savedMargin.prop = prop;
    savedMargin.value = html.style.getPropertyValue(prop);
    savedMargin.priority = html.style.getPropertyPriority(prop);
    requestAnimationFrame(() => {
      if (savedMargin.prop !== prop) return;
      const size = prop === "margin-left" || prop === "margin-right" ? clock.offsetWidth : clock.offsetHeight;
      html.style.setProperty(prop, `${size}px`, "important");
    });
  }

  // ---------------------------------------------------------------- render
  function render() {
    const visible = s.enabled && !hiddenOnPage;
    if (!visible) {
      if (host) host.style.setProperty("display", "none", "important");
      closePanel();
      stopTimer();
      applyPush(false);
      return;
    }
    if (!host) build();
    host.style.removeProperty("display");

    clock.className = `clock ${s.layout}` + (panelOpen ? " panel-open" : "") + (drag && drag.moved ? " dragging" : "");
    styleEl.textContent = clockCss();
    if (s.layout !== "floating") {
      clock.style.left = "";
      clock.style.top = "";
    }
    dateEl.hidden = !s.showDate;

    tick();
    startTimer();
    applyPush(s.pushContent && s.layout !== "floating");

    if (panelOpen) {
      syncPanel();
      requestAnimationFrame(positionPanel);
    }
  }

  // ---------------------------------------------------------------- dragging
  function wireClock() {
    clock.addEventListener("pointerdown", (e) => {
      if (s.layout !== "floating" || e.button !== 0 || e.target.closest(".gear")) return;
      const r = clock.getBoundingClientRect();
      drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
      clock.setPointerCapture(e.pointerId);
      e.preventDefault(); // no text selection while dragging
    });

    clock.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 3) return;
      if (!drag.moved) {
        drag.moved = true;
        clock.classList.add("dragging");
        closePanel();
      }
      const { w, h } = viewport();
      const x = clamp(e.clientX - drag.dx, 0, Math.max(0, w - clock.offsetWidth));
      const y = clamp(e.clientY - drag.dy, 0, Math.max(0, h - clock.offsetHeight));
      clock.style.left = `${x}px`;
      clock.style.top = `${y}px`;
    });

    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      clock.classList.remove("dragging");
      if (!moved) return;
      // Save as a fraction of the free space so it stays on screen in any window size.
      const { w, h } = viewport();
      const maxX = w - clock.offsetWidth;
      const maxY = h - clock.offsetHeight;
      const fx = maxX > 0 ? parseFloat(clock.style.left) / maxX : 0;
      const fy = maxY > 0 ? parseFloat(clock.style.top) / maxY : 0;
      save({ floatX: Math.round(fx * 10000) / 10000, floatY: Math.round(fy * 10000) / 10000 }, 0);
    };
    clock.addEventListener("pointerup", endDrag);
    clock.addEventListener("pointercancel", endDrag);

    gearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      panelOpen ? closePanel() : openPanel();
    });

    clock.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openPanel();
    });
  }

  // ---------------------------------------------------------------- preferences panel
  function wirePanel() {
    const onEdit = (e) => {
      const el = e.target;
      const key = el.dataset && el.dataset.key;
      if (!key) return;
      let value;
      if (el.type === "checkbox") value = el.checked;
      else if (el.type === "range") value = Number(el.value);
      else value = el.value;
      save({ [key]: value }, el.type === "range" || el.type === "color" ? 300 : 0);
    };
    panel.addEventListener("input", onEdit);
    panel.addEventListener("change", onEdit);

    panel.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "close") closePanel();
      if (act === "resetPos") save({ floatX: CLOCKBAR_DEFAULTS.floatX, floatY: CLOCKBAR_DEFAULTS.floatY }, 0);
      if (act === "hide") {
        hiddenOnPage = true;
        render();
      }
      if (act === "more") {
        browser.runtime.sendMessage({ type: "clockbar:openOptions" });
        closePanel();
      }
    });

    // Keep keystrokes in the panel from triggering the page's shortcuts.
    panel.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") closePanel();
    });

    // Click anywhere outside the clock closes the panel.
    document.addEventListener("pointerdown", (e) => {
      if (panelOpen && !e.composedPath().includes(host)) closePanel();
    }, true);

    window.addEventListener("resize", () => {
      placeFloating();
      if (panelOpen) positionPanel();
    });
  }

  function syncPanel() {
    const focused = shadow.activeElement;
    for (const el of panel.querySelectorAll("[data-key]")) {
      if (el === focused && (el.type === "range" || el.type === "color")) continue; // don't fight the user mid-drag
      const v = s[el.dataset.key];
      if (el.type === "checkbox") el.checked = Boolean(v);
      else el.value = v;
    }
    panel.querySelector('[data-out="fontSize"]').textContent = ` ${s.fontSize}px`;
    panel.querySelector('[data-out="opacity"]').textContent = ` ${s.opacity}%`;
    panel.querySelector('[data-act="resetPos"]').hidden = s.layout !== "floating";
  }

  function positionPanel() {
    if (!panelOpen) return;
    const r = clock.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const { w, h } = viewport();
    let left, top;
    if (s.layout === "left" || s.layout === "right") {
      left = s.layout === "left" ? r.right + 8 : r.left - pw - 8;
      top = r.top + r.height / 2 - ph / 2;
    } else {
      top = r.bottom + 8 + ph <= h ? r.bottom + 8 : r.top - ph - 8;
      left = r.left + r.width / 2 - pw / 2;
    }
    panel.style.left = `${clamp(left, 8, Math.max(8, w - pw - 8))}px`;
    panel.style.top = `${clamp(top, 8, Math.max(8, h - ph - 8))}px`;
  }

  function openPanel() {
    if (!host) return;
    panelOpen = true;
    panel.hidden = false;
    clock.classList.add("panel-open");
    syncPanel();
    positionPanel();
    panel.querySelector("select").focus();
  }

  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false;
    panel.hidden = true;
    clock.classList.remove("panel-open");
  }

  // ---------------------------------------------------------------- start
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && timerId) tick();
  });

  // Live-update when settings change (from this page, other tabs, or the settings page).
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const next = { ...s };
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in pending) continue; // a newer local edit is still waiting to be saved
      next[key] = newValue === undefined ? CLOCKBAR_DEFAULTS[key] : newValue;
    }
    if (changes.enabled && changes.enabled.newValue) hiddenOnPage = false;
    s = clockbarNormalize(next);
    render();
  });

  browser.storage.sync.get(CLOCKBAR_DEFAULTS).then((stored) => {
    s = clockbarNormalize(stored);
    render();
  });
})();
