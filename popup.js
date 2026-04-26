const ctx = document.getElementById("ctx");
const captureBtn = document.getElementById("capture");
const settingsBtn = document.getElementById("settings");

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onNyt =
    tab && /^https:\/\/www\.nytimes\.com\/(crosswords|games)\//.test(tab.url || "");

  if (!onNyt) {
    ctx.textContent = "Open a NYT crossword page to capture clues.";
    captureBtn.disabled = true;
    return;
  }

  ctx.textContent = "Ready on NYT crossword.";
  captureBtn.disabled = false;
  captureBtn.addEventListener("click", async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_CLUE" });
      window.close();
    } catch (err) {
      ctx.textContent = "Couldn't reach the page. Try reloading the puzzle tab.";
    }
  });
})();

settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
