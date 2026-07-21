import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

// Interview-prep problems are reference problems (has_tests=false), so there is no
// autograder to record "solved". Progress here is a lightweight, student-driven
// "reviewed" flag persisted in localStorage — no backend, no migration. This is the
// single source of truth for the progress strip, topic progress, and "strongest
// topic" callouts on the Interview Prep page.

const REVIEWED_KEY = "csnav.interviewReviewed";
const API_BASE = getApiBase();
const CHANGE_EVENT = "interview-reviewed-change";

function readReviewedSet() {
  try {
    const raw = localStorage.getItem(REVIEWED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeReviewedSet(set) {
  try {
    localStorage.setItem(REVIEWED_KEY, JSON.stringify([...set]));
  } catch {
    // Storage full / blocked (private mode): progress just won't persist. Non-fatal.
  }
}

function authHeaders() {
  const token = localStorage.getItem("token");
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : null;
}

function mergeServerProgress(items = []) {
  const reviewed = readReviewedSet();
  const solved = readSolvedSet();
  items.forEach((item) => {
    if (item.status === "reviewed" || item.status === "solved") reviewed.add(item.question_id);
    if (item.status === "solved") solved.add(item.question_id);
  });
  writeReviewedSet(reviewed);
  writeSolvedSet(solved);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function fetchInterviewProgress() {
  const headers = authHeaders();
  if (!headers) return [];
  try {
    const response = await fetch(`${API_BASE}/api/coding/interview/progress`, { headers });
    if (!response.ok) return [];
    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];
    mergeServerProgress(items);
    return items;
  } catch {
    return [];
  }
}

export async function saveInterviewProgress(questionId, updates = {}) {
  if (!questionId) return null;
  const headers = authHeaders();
  if (!headers) return null;
  try {
    const response = await fetch(`${API_BASE}/api/coding/interview/questions/${encodeURIComponent(questionId)}/progress`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(updates),
    });
    if (!response.ok) return null;
    const saved = await response.json();
    mergeServerProgress([saved]);
    return saved;
  } catch {
    return null;
  }
}

// React hook: returns the reviewed Set plus toggle/mark helpers. A custom window
// event keeps multiple mounts (e.g. the page and a future mini-widget) in sync,
// since the native "storage" event only fires across tabs, not within one.
export function useInterviewReviewed() {
  const [reviewed, setReviewed] = useState(readReviewedSet);

  useEffect(() => {
    const sync = () => setReviewed(readReviewedSet());
    fetchInterviewProgress();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setReviewedFor = useCallback((questionId, isReviewed) => {
    if (!questionId) return;
    const next = readReviewedSet();
    if (isReviewed) next.add(questionId);
    else next.delete(questionId);
    writeReviewedSet(next);
    setReviewed(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    saveInterviewProgress(questionId, { status: isReviewed ? "reviewed" : "not_started" });
  }, []);

  const toggleReviewed = useCallback(
    (questionId) => setReviewedFor(questionId, !readReviewedSet().has(questionId)),
    [setReviewedFor],
  );

  return { reviewed, setReviewedFor, toggleReviewed };
}

// Marks a single problem reviewed outside of React (e.g. when "View solution" is
// clicked from anywhere). Fires the same sync event the hook listens for.
export function markInterviewReviewed(questionId, updates = {}) {
  if (!questionId) return;
  const next = readReviewedSet();
  if (!next.has(questionId)) {
    next.add(questionId);
    writeReviewedSet(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  saveInterviewProgress(questionId, { status: "reviewed", ...updates });
}

// ── Solved tracking ────────────────────────────────────────────────────────
// Separate from "reviewed": solved means the student actually got the problem right —
// either they hit Mark Solved during a mock, or their code passed the auto-grader.
// Backs the "solved" count on the Interview Prep topic cards. localStorage-only.
const SOLVED_KEY = "csnav.interviewSolved";

function readSolvedSet() {
  try {
    const raw = localStorage.getItem(SOLVED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeSolvedSet(set) {
  try {
    localStorage.setItem(SOLVED_KEY, JSON.stringify([...set]));
  } catch {
    // Storage full / blocked: solved state just won't persist. Non-fatal.
  }
}

// Mark an interview problem solved (from a mock Mark-Solved or a passing grade). Also
// counts as reviewed. Idempotent; fires the sync event so the topic cards update live.
export function markInterviewSolved(questionId, updates = {}) {
  if (!questionId) return;
  const solved = readSolvedSet();
  if (!solved.has(questionId)) {
    solved.add(questionId);
    writeSolvedSet(solved);
  }
  // Solving implies reviewed, so it also counts toward review progress.
  markInterviewReviewed(questionId, updates);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  saveInterviewProgress(questionId, { status: "solved", ...updates });
}

// React hook: the set of solved interview problem ids, kept in sync across mounts.
export function useInterviewSolved() {
  const [solved, setSolved] = useState(readSolvedSet);
  useEffect(() => {
    const sync = () => setSolved(readSolvedSet());
    fetchInterviewProgress();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return solved;
}
