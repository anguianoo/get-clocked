// Toolbar button opens the full settings page.
browser.browserAction.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

// The in-page preferences panel asks for the full settings page this way
// (content scripts can't open it directly).
browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "clockbar:openOptions") browser.runtime.openOptionsPage();
});

// Keyboard shortcut (Alt+Shift+K by default) toggles the clock everywhere.
browser.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-clock") return;
  const { enabled } = await browser.storage.sync.get({ enabled: CLOCKBAR_DEFAULTS.enabled });
  await browser.storage.sync.set({ enabled: !enabled });
});
