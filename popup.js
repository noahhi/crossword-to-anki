const ctx = document.getElementById("ctx");
const captureBtn = document.getElementById("capture");
const settingsBtn = document.getElementById("settings");

// Keep in sync with CROSSWORD_URL_PATTERNS in background.js. Vox serves its
// puzzle from an amuselabs.com iframe, so both the article URL and a directly
// opened player URL count as a crossword page.
const SITES = [
  [/^https:\/\/www\.nytimes\.com\/(crosswords|games)\//, "NYT crossword"],
  [/^https:\/\/www\.newyorker\.com\/puzzles-and-games-dept\/crossword/, "New Yorker crossword"],
  [/^https:\/\/www\.vox\.com\/[^?#]*crossword/, "Vox crossword"],
  [/^https:\/\/[\w-]+\.amuselabs\.com\//, "PuzzleMe crossword"],
];

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || "";
  const match = SITES.find(([re]) => re.test(url));

  if (!match) {
    ctx.textContent = "Open an NYT, New Yorker or Vox crossword page to capture clues.";
    captureBtn.disabled = true;
    return;
  }

  ctx.textContent = `Ready on ${match[1]}.`;
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
