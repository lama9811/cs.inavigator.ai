import { useCallback, useEffect, useState } from "react";

// Interview-prep problems are reference problems (has_tests=false), so there is no
// autograder to record "solved". Progress here is a lightweight, student-driven
// "reviewed" flag persisted in localStorage — no backend, no migration. This is the
// single source of truth for the progress strip, topic progress, and "strongest
// topic" callouts on the Interview Prep page.

const REVIEWED_KEY = "csnav.interviewReviewed";

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

// React hook: returns the reviewed Set plus toggle/mark helpers. A custom window
// event keeps multiple mounts (e.g. the page and a future mini-widget) in sync,
// since the native "storage" event only fires across tabs, not within one.
export function useInterviewReviewed() {
  const [reviewed, setReviewed] = useState(readReviewedSet);

  useEffect(() => {
    const sync = () => setReviewed(readReviewedSet());
    window.addEventListener("interview-reviewed-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("interview-reviewed-change", sync);
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
    window.dispatchEvent(new Event("interview-reviewed-change"));
  }, []);

  const toggleReviewed = useCallback(
    (questionId) => setReviewedFor(questionId, !readReviewedSet().has(questionId)),
    [setReviewedFor],
  );

  return { reviewed, setReviewedFor, toggleReviewed };
}

// Marks a single problem reviewed outside of React (e.g. when "View solution" is
// clicked from anywhere). Fires the same sync event the hook listens for.
export function markInterviewReviewed(questionId) {
  if (!questionId) return;
  const next = readReviewedSet();
  if (next.has(questionId)) return;
  next.add(questionId);
  writeReviewedSet(next);
  window.dispatchEvent(new Event("interview-reviewed-change"));
}
