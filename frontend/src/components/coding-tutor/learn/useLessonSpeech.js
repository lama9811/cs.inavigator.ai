import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Read-aloud for a lesson, built on the browser's free Web Speech API
// (window.speechSynthesis). No API key, no dependency, no per-character billing.
//
// Design decisions (from ROADMAP 1.4b), because a naive read-aloud is worse than none:
//   - Read the PROSE, announce code by its caption. A voice saying "for i in range
//     open paren five close paren colon" is worse than silence.
//   - SKIP check blocks entirely. Reading the choices aloud in order gives the answer
//     away by tone, and the checks are the one place the student is meant to think.
//   - Stop on navigation / unmount. Audio that keeps talking after you leave is the
//     classic bug here.
//   - Never autoplay (honored by the caller: playback starts only on a click).
//
// The Web Speech API speaks progressively and exposes NO seekable timeline, so there is
// no real "1:23 / 4:00" clock or 10-second seek. Instead we split the lesson into
// spoken SEGMENTS (roughly one per block) and let the user skip by segment and see
// "section 3 of 12". That is the honest unit this API can actually offer.

// Strip inline-code backticks so the voice reads the word, not the punctuation.
function stripInlineCode(text) {
  return String(text || "").replace(/`([^`]+)`/g, "$1");
}

// Turn the lesson's blocks into an ordered list of spoken segments. Each segment is
// one utterance with a short human label (used only for aria / debugging).
export function lessonToSegments(lesson) {
  if (!lesson) return [];
  const segments = [];
  const push = (label, text) => {
    const clean = stripInlineCode(text).trim();
    if (clean) segments.push({ label, text: clean });
  };

  push("Title", lesson.title);
  if (lesson.summary) push("Summary", lesson.summary);

  for (const block of lesson.blocks || []) {
    switch (block.kind) {
      case "text":
        push("Idea", block.body);
        break;
      case "callout":
        // Read the callout as "Tip. <body>" so the listener knows its weight.
        push(block.title || "Note", `${block.title || block.tone || "Note"}. ${block.body}`);
        break;
      case "code":
        // Announce code by its caption only; never read the code characters.
        if (block.caption) push("Example", `Example. ${block.caption} The code is shown on screen.`);
        break;
      case "compare":
        if (block.caption) push("Comparison", `Comparison. ${block.caption} The two versions are shown side by side on screen.`);
        break;
      case "list": {
        const items = (block.items || []).map(stripInlineCode).join(". ");
        push("List", `${block.title ? block.title + ". " : ""}${items}`);
        break;
      }
      // "check" is deliberately skipped: reading the choices aloud reveals the answer.
      default:
        break;
    }
  }
  return segments;
}

const SUPPORTED = typeof window !== "undefined" && "speechSynthesis" in window;

export function useLessonSpeech(lesson) {
  const segments = useMemo(() => lessonToSegments(lesson), [lesson]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  // Guards an intentional cancel() (skip/stop) from being treated as "segment ended,
  // advance to the next one" inside the utterance onend handler.
  const suppressAdvanceRef = useRef(false);

  const speakFrom = useCallback((startIndex) => {
    if (!SUPPORTED || !segments.length) return;
    const synth = window.speechSynthesis;
    suppressAdvanceRef.current = true;
    synth.cancel(); // clear any queued utterances
    suppressAdvanceRef.current = false;

    const clamped = Math.max(0, Math.min(startIndex, segments.length - 1));
    indexRef.current = clamped;
    setIndex(clamped);

    const utterance = new SpeechSynthesisUtterance(segments[clamped].text);
    utterance.rate = 0.95;
    utterance.onend = () => {
      // Natural end of a segment (not a manual skip/stop): advance, or finish.
      if (suppressAdvanceRef.current) return;
      const next = indexRef.current + 1;
      if (next < segments.length) {
        speakFrom(next);
      } else {
        setIsPlaying(false);
        setIsPaused(false);
      }
    };
    synth.speak(utterance);
    setIsPlaying(true);
    setIsPaused(false);
  }, [segments]);

  const play = useCallback(() => {
    if (!SUPPORTED) return;
    const synth = window.speechSynthesis;
    if (isPaused) {
      synth.resume();
      setIsPaused(false);
      setIsPlaying(true);
      return;
    }
    speakFrom(indexRef.current);
  }, [isPaused, speakFrom]);

  const pause = useCallback(() => {
    if (!SUPPORTED || !isPlaying) return;
    window.speechSynthesis.pause();
    setIsPaused(true);
    setIsPlaying(false);
  }, [isPlaying]);

  const stop = useCallback(() => {
    if (!SUPPORTED) return;
    suppressAdvanceRef.current = true;
    window.speechSynthesis.cancel();
    suppressAdvanceRef.current = false;
    setIsPlaying(false);
    setIsPaused(false);
    indexRef.current = 0;
    setIndex(0);
  }, []);

  const skip = useCallback((delta) => {
    if (!SUPPORTED || !segments.length) return;
    speakFrom(indexRef.current + delta);
  }, [segments.length, speakFrom]);

  const next = useCallback(() => skip(1), [skip]);
  const prev = useCallback(() => skip(-1), [skip]);

  // Stop speaking when the lesson changes or the component unmounts. Audio that keeps
  // talking after you navigate away is the classic read-aloud bug.
  useEffect(() => {
    return () => {
      if (SUPPORTED) {
        suppressAdvanceRef.current = true;
        window.speechSynthesis.cancel();
      }
    };
  }, [lesson]);

  return {
    supported: SUPPORTED && segments.length > 0,
    isPlaying,
    isPaused,
    index,
    currentLabel: segments[index]?.label || "",
    currentText: segments[index]?.text || "",
    total: segments.length,
    play,
    pause,
    stop,
    next,
    prev,
  };
}
