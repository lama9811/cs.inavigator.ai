import { useCallback, useEffect, useState } from "react";

// Past mock-interview attempts, stored locally (no backend sync). Each finished mock
// appends one record so students can revisit what they did and how they scored. Local
// -first mirrors interviewProgress.js: same event-sync pattern, same graceful failure
// when storage is blocked (private mode). Capped so the list can't grow unbounded.

const HISTORY_KEY = "csnav.interviewHistory";
const MAX_ATTEMPTS = 20;

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_ATTEMPTS)));
  } catch {
    // Storage full / blocked: history just won't persist. Non-fatal.
  }
}

// Append a finished attempt. Newest first, capped at MAX_ATTEMPTS. `record` should be
// { id, dateISO, total, solved, attempted, skipped, timeUsedMs, score, problems[] }.
export function appendInterviewAttempt(record) {
  if (!record) return;
  const next = [record, ...readHistory()].slice(0, MAX_ATTEMPTS);
  writeHistory(next);
  window.dispatchEvent(new Event("interview-history-change"));
}

// Merge grading verdicts (or any late-arriving fields) into an already-stored attempt.
// Used when async grading finishes after the record was first written.
export function updateInterviewAttempt(id, patch) {
  if (!id) return;
  const list = readHistory();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...patch };
  writeHistory(list);
  window.dispatchEvent(new Event("interview-history-change"));
}

export function clearInterviewHistory() {
  writeHistory([]);
  window.dispatchEvent(new Event("interview-history-change"));
}

// Fold the stored attempts into the signals the achievement badges read. A mock
// carries several problems, so `solved`/`total` per attempt lets us reward *how
// well* a mock went, not just that it finished. Reads best-of across attempts.
export function summarizeInterviewHistory() {
  const list = readHistory();
  let bestSolved = 0;      // most problems passed in any single mock
  let clearedAllMock = false; // a mock where every problem was solved
  list.forEach((attempt) => {
    const solved = Number(attempt?.solved) || 0;
    const total = Number(attempt?.total) || 0;
    if (solved > bestSolved) bestSolved = solved;
    if (total > 0 && solved >= total) clearedAllMock = true;
  });
  return {
    mockAttempts: list.length,
    bestMockSolved: bestSolved,
    clearedAllMock,
  };
}

// React hook: the list of past attempts, kept in sync across mounts via a custom event
// (the native "storage" event only fires across tabs, not within one).
export function useInterviewHistory() {
  const [history, setHistory] = useState(readHistory);

  useEffect(() => {
    const sync = () => setHistory(readHistory());
    window.addEventListener("interview-history-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("interview-history-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const clear = useCallback(() => clearInterviewHistory(), []);
  return { history, clear };
}
