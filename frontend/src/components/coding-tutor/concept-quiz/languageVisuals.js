import { SiPython, SiOpenjdk, SiJavascript, SiCplusplus } from "react-icons/si";

// One source of truth for per-language visuals shared by the language cards and
// the landing hero. Keyed by the backend language id (python/java/javascript/cpp).
//   Icon     – brand logo
//   tint     – accent color for the card rail / icon badge
//   note     – short one-liner (used on the compact hero)
//   blurb    – fuller description for the fleshed-out cards
//   signature – the language-specific category each language uniquely gets
export const LANGUAGE_VISUALS = {
  python: {
    tint: "#3776ab",
    note: "Readable, beginner-friendly.",
    blurb:
      "A clean, readable language that's great for your first steps — practice the core ideas without heavy syntax.",
    signature: "Tuples",
    Icon: SiPython,
  },
  java: {
    tint: "#e76f00",
    note: "Typed, class-based.",
    blurb:
      "A statically-typed, class-based language used across industry and CS courses — get comfortable with structure and types.",
    signature: "Methods",
    Icon: SiOpenjdk,
  },
  javascript: {
    tint: "#c9a227",
    note: "The language of the web.",
    blurb:
      "The language that runs in every browser — practice the flexible, dynamic style that powers the web.",
    signature: "Objects",
    Icon: SiJavascript,
  },
  cpp: {
    tint: "#00599c",
    note: "Close to the machine.",
    blurb:
      "A powerful, lower-level language where you manage more yourself — build a solid mental model of how code runs.",
    signature: "Pointers",
    Icon: SiCplusplus,
  },
};
