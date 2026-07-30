// Workspace draft persistence
// =============================
// The Coding Tutor workspace lives inside CodingTutor.jsx, which is only mounted
// on a coding-workspace route (see Chatbox.jsx). Navigating to the full chat /
// chat history unmounts it, destroying all in-memory editor state. Before this,
// code the student typed but never ran was lost, the problem lost its
// in-progress status, and the editor reset to an empty Python buffer.
//
// This module persists a per-device draft of the editor buffer keyed by
// problem + language, so unrun code survives an unmount and language switches
// keep each language's buffer independent. Purely localStorage; no backend.

import { scopedStorageKey } from "./storageScope";

const DRAFT_PREFIX = "csnav.workspaceDraft"; // + :<problemId>:<language>
const LAST_BASE_KEY = "csnav.workspaceLast";      // { problemId, language, updatedAt }
const DRAFT_INDEX_BASE_KEY = "csnav.workspaceDraftIndex"; // [key, ...] for pruning
const MAX_DRAFTS = 60; // plenty for a practice session; prune oldest beyond this

function draftKey(problemId, language) {
  return scopedStorageKey(`${DRAFT_PREFIX}:${problemId}:${language}`);
}

const lastKey = () => scopedStorageKey(LAST_BASE_KEY);
const draftIndexKey = () => scopedStorageKey(DRAFT_INDEX_BASE_KEY);

function readIndex() {
  try {
    const raw = localStorage.getItem(draftIndexKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(list) {
  try {
    localStorage.setItem(draftIndexKey(), JSON.stringify(list));
  } catch {
    // Storage full/blocked: index just won't persist. Non-fatal.
  }
}

// Move `key` to the most-recent end of the LRU index and prune the oldest
// drafts if we're over the cap.
function touchIndex(key) {
  const list = readIndex().filter(k => k !== key);
  list.push(key);
  while (list.length > MAX_DRAFTS) {
    const stale = list.shift();
    try {
      localStorage.removeItem(stale);
    } catch {
      // ignore
    }
  }
  writeIndex(list);
}

function removeFromIndex(key) {
  writeIndex(readIndex().filter(k => k !== key));
}

// Save the current editor buffer for a problem + language. An empty/whitespace
// draft is treated as "no draft" and cleared so blanks don't shadow the starter.
export function saveDraft(problemId, language, code) {
  if (!problemId || !language) return;
  const key = draftKey(problemId, language);
  try {
    if (!code || !code.trim()) {
      localStorage.removeItem(key);
      removeFromIndex(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify({ code, savedAt: Date.now() }));
    touchIndex(key);
  } catch (error) {
    console.warn("[workspace-draft] save failed", error);
  }
}

// Read a saved draft's code for a problem + language (or null if none).
export function readDraftEntry(problemId, language) {
  if (!problemId || !language) return null;
  try {
    const raw = localStorage.getItem(draftKey(problemId, language));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.code === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function readDraft(problemId, language) {
  return readDraftEntry(problemId, language)?.code || null;
}

// Clear a draft once it's no longer needed (problem solved, explicit reset).
export function clearDraft(problemId, language) {
  if (!problemId || !language) return;
  const key = draftKey(problemId, language);
  try {
    localStorage.removeItem(key);
    removeFromIndex(key);
  } catch (error) {
    console.warn("[workspace-draft] clear failed", error);
  }
}

// Remember the last Practice Library problem + language the student had open, so
// the workspace can auto-reopen it after an unmount (navigating to chat and back).
// Interview prep uses the editor too, but it should not become the default
// Workspace tab later.
export function saveLastWorkspace(problemId, language) {
  if (!problemId || !language) return;
  if (String(problemId).startsWith("iv-")) return;
  try {
    localStorage.setItem(lastKey(), JSON.stringify({
      problemId,
      language,
      source: "practice",
      updatedAt: new Date().toISOString(),
    }));
  } catch {
    // Non-fatal.
  }
}

export function readLastWorkspace() {
  try {
    const raw = localStorage.getItem(lastKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.problemId && parsed?.language) {
      if (parsed.source && parsed.source !== "practice") return null;
      if (String(parsed.problemId).startsWith("iv-")) return null;
      return { ...parsed, source: "practice" };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearLastWorkspace() {
  try {
    localStorage.removeItem(lastKey());
  } catch {
    // Non-fatal.
  }
}
