// Marker helpers for the inline Advising Form panel.
//
// The advising agent emits this marker (with a JSON payload of known/pre-filled
// values) to tell the chat UI to render the form panel. Format:
//   [ADVISING_FORM_PANEL]{"advisor":"Dr. Guo","gpa":"3.4",...}
const PANEL_MARKER = /\[ADVISING_FORM_PANEL\]\s*(\{[\s\S]*?\})?/i;

export function hasAdvisingPanel(text) {
  return typeof text === "string" && PANEL_MARKER.test(text);
}

export function stripAdvisingPanel(text) {
  return typeof text === "string" ? text.replace(PANEL_MARKER, "") : text;
}

// Pull the known-values JSON out of the marker, if present. Returns {} on absence
// or malformed JSON so the panel just starts empty rather than crashing.
export function parseAdvisingPrefill(text) {
  if (typeof text !== "string") return {};
  const m = text.match(PANEL_MARKER);
  if (!m || !m[1]) return {};
  try {
    return JSON.parse(m[1]);
  } catch {
    return {};
  }
}
