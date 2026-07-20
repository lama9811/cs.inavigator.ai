import { SiPython, SiOpenjdk, SiJavascript, SiCplusplus } from "react-icons/si";

// One source of truth for per-language visuals shared by the language cards and
// the landing hero. Keyed by the backend language id (python/java/javascript/cpp).
//   Icon     – brand logo
//   tint     – accent color for the card rail / icon badge
//   note     – short one-liner (used on the compact hero)
//   blurb    – fuller description for the fleshed-out cards
//   signature – the language-specific category each language uniquely gets
//
// The four tints must stay tellable apart AT A GLANCE, because on the language grid
// the color is the fastest thing a student reads. C++ used the official #00599c, which
// is a blue sitting right next to Python's #3776ab; on the cards they registered as the
// same language twice. C++ is deliberately off-brand here so the set stays legible.
//
// Every tint is also a button background with white label text, so each is checked for
// WCAG contrast against #fff. Python 4.84, C++ 7.10. Java (3.15) and JavaScript (2.42)
// are below the 4.5 threshold, which is a real accessibility gap and is filed in
// ROADMAP; do not add a fifth low-contrast tint to it.
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
    signature: "Classes & Objects",
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
    // Deep violet, NOT the official C++ blue (#00599c): that read as a second Python
    // card on the grid. Purple is the only free hue left, since Java owns orange and
    // JavaScript owns gold. Contrast on white is 7.10, so the CTA label stays crisp.
    tint: "#6d28d9",
    note: "Close to the machine.",
    blurb:
      "A powerful, lower-level language where you manage more yourself — build a solid mental model of how code runs.",
    signature: "Pointers",
    Icon: SiCplusplus,
  },
};
