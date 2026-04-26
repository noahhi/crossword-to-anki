// AnkiConnect client. AnkiConnect listens on http://127.0.0.1:8765 and accepts
// JSON-RPC-style POST requests. See https://foosoft.net/projects/anki-connect/

const ANKI_URL = "http://127.0.0.1:8765";
const ANKI_VERSION = 6;

export async function ankiInvoke(action, params = {}) {
  let response;
  try {
    response = await fetch(ANKI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: ANKI_VERSION, params }),
    });
  } catch (err) {
    throw new Error(
      "Could not reach AnkiConnect. Is Anki running with the AnkiConnect add-on installed?"
    );
  }

  if (!response.ok) {
    throw new Error(`AnkiConnect HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data.result;
}

export async function getDeckNames() {
  return ankiInvoke("deckNames");
}

export async function getModelNames() {
  return ankiInvoke("modelNames");
}

export async function getModelFieldNames(modelName) {
  return ankiInvoke("modelFieldNames", { modelName });
}

export async function findNotesByAnswer(deckName, answerField, answer) {
  // Search the user's deck for an existing note where the answer field matches.
  // Quoted to handle multi-word answers.
  const query = `deck:"${deckName}" "${answerField}:${answer}"`;
  return ankiInvoke("findNotes", { query });
}

export async function getNotesInfo(noteIds) {
  return ankiInvoke("notesInfo", { notes: noteIds });
}

export async function updateNoteFields(noteId, fields) {
  return ankiInvoke("updateNoteFields", { note: { id: noteId, fields } });
}

export async function addNote({ deckName, modelName, fields, tags }) {
  return ankiInvoke("addNote", {
    note: {
      deckName,
      modelName,
      fields,
      tags,
      options: {
        // We handle dedupe ourselves so we can append clues to existing cards.
        allowDuplicate: true,
      },
    },
  });
}
