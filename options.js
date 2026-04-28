import {
  getDeckNames,
  getModelNames,
  getModelFieldNames,
} from "./anki.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  status: $("#anki-status"),
  refresh: $("#refresh"),
  setup: $("#setup"),
  deck: $("#deck"),
  model: $("#model"),
  fieldset: $("#field-mapping"),
  clueField: $("#clueField"),
  answerField: $("#answerField"),
  notesField: $("#notesField"),
  sourceField: $("#sourceField"),
  dateField: $("#dateField"),
  imageField: $("#imageField"),
  autoFetchImage: $("#autoFetchImage"),
  extraTags: $("#extraTags"),
  save: $("#save"),
  saveStatus: $("#save-status"),
  origin: $("#origin-line"),
};

els.origin.textContent = `chrome-extension://${chrome.runtime.id}`;

els.refresh.addEventListener("click", init);
els.model.addEventListener("change", () => loadModelFields(els.model.value));
els.save.addEventListener("click", saveSettings);

init();

async function init() {
  els.status.textContent = "Checking AnkiConnect…";
  els.setup.hidden = true;

  let decks, models;
  try {
    [decks, models] = await Promise.all([getDeckNames(), getModelNames()]);
  } catch (err) {
    els.status.innerHTML = `<span class="bad">Couldn't reach AnkiConnect:</span> ${escape(
      err.message
    )}<br><small>Make sure Anki is running and AnkiConnect is configured to allow this extension's origin (see below).</small>`;
    return;
  }

  els.status.innerHTML = `<span class="ok">Connected.</span> ${decks.length} decks, ${models.length} note types.`;
  els.setup.hidden = false;

  // Populate deck dropdown.
  fillSelect(els.deck, decks);
  // Populate model dropdown.
  fillSelect(els.model, models);

  // Restore saved settings if any.
  const saved = await chrome.storage.sync.get([
    "deckName",
    "modelName",
    "clueField",
    "answerField",
    "notesField",
    "sourceField",
    "dateField",
    "imageField",
    "autoFetchImage",
    "extraTags",
  ]);
  if (saved.deckName && decks.includes(saved.deckName)) {
    els.deck.value = saved.deckName;
  }
  if (saved.modelName && models.includes(saved.modelName)) {
    els.model.value = saved.modelName;
  }
  if (saved.extraTags) els.extraTags.value = saved.extraTags;
  els.autoFetchImage.checked = !!saved.autoFetchImage;

  await loadModelFields(els.model.value, saved);
}

function fillSelect(sel, options, includeBlank = false) {
  sel.innerHTML = "";
  if (includeBlank) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "— none —";
    sel.appendChild(o);
  }
  options.forEach((name) => {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  });
}

async function loadModelFields(modelName, saved = {}) {
  if (!modelName) return;
  let fields;
  try {
    fields = await getModelFieldNames(modelName);
  } catch (err) {
    els.status.innerHTML = `<span class="bad">Error loading fields: ${escape(
      err.message
    )}</span>`;
    return;
  }

  // Required fields: no blank option.
  fillSelect(els.clueField, fields, false);
  fillSelect(els.answerField, fields, false);
  // Optional fields: include "none".
  fillSelect(els.notesField, fields, true);
  fillSelect(els.sourceField, fields, true);
  fillSelect(els.dateField, fields, true);
  fillSelect(els.imageField, fields, true);

  // Heuristic defaults — match common field names.
  setBestGuess(els.clueField, saved.clueField, fields, [
    "Clue",
    "Front",
    "Question",
  ]);
  setBestGuess(els.answerField, saved.answerField, fields, [
    "Answer",
    "Back",
    "Solution",
  ]);
  setBestGuess(els.notesField, saved.notesField, fields, [
    "Notes",
    "Extra",
    "Comment",
  ]);
  setBestGuess(els.sourceField, saved.sourceField, fields, [
    "Source",
  ]);
  setBestGuess(els.dateField, saved.dateField, fields, ["Date", "Added"]);
  setBestGuess(els.imageField, saved.imageField, fields, ["Image", "Picture", "Photo"]);

  els.fieldset.disabled = false;
}

function setBestGuess(selectEl, savedValue, fields, candidates) {
  if (savedValue && [...selectEl.options].some((o) => o.value === savedValue)) {
    selectEl.value = savedValue;
    return;
  }
  for (const c of candidates) {
    const hit = fields.find((f) => f.toLowerCase() === c.toLowerCase());
    if (hit) {
      selectEl.value = hit;
      return;
    }
  }
}

async function saveSettings() {
  const data = {
    deckName: els.deck.value,
    modelName: els.model.value,
    clueField: els.clueField.value,
    answerField: els.answerField.value,
    notesField: els.notesField.value || "",
    sourceField: els.sourceField.value || "",
    dateField: els.dateField.value || "",
    imageField: els.imageField.value || "",
    autoFetchImage: els.autoFetchImage.checked,
    extraTags: els.extraTags.value.trim(),
  };
  await chrome.storage.sync.set(data);
  els.saveStatus.textContent = "Saved.";
  setTimeout(() => (els.saveStatus.textContent = ""), 1500);
}

function escape(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}
