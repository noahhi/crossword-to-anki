const ctx = document.getElementById("ctx");
const captureBtn = document.getElementById("capture");
const settingsBtn = document.getElementById("settings");

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || "";
  const onNyt = /^https:\/\/www\.nytimes\.com\/(crosswords|games)\//.test(url);
  const onNewYorker = /^https:\/\/www\.newyorker\.com\/puzzles-and-games-dept\/crossword/.test(url);
  const onCrossword = onNyt || onNewYorker;

  if (!onCrossword) {
    ctx.textContent = "Open an NYT or New Yorker crossword page to capture clues.";
    captureBtn.disabled = true;
    return;
  }

  ctx.textContent = onNewYorker ? "Ready on New Yorker crossword." : "Ready on NYT crossword.";
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
