// Validation/visibility helpers for the advising forms. Kept out of the renderer
// component file so that file only exports a component (Fast Refresh friendly).
import { isFieldActive } from "../coding-tutor/advisingFormSchema";

// Visible fields whose required condition is unmet (empty). Conditional fields
// only count when their trigger condition is active.
export function missingRequired(form, values) {
  const missing = [];
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!isFieldActive(field, values)) continue;
      const isRequired = field.required || Boolean(field.requiredWhen);
      if (isRequired && !String(values[field.id] || "").trim()) {
        missing.push(field);
      }
    }
  }
  return missing;
}

// All currently-visible fields (for the progress meter).
export function visibleFields(form, values) {
  return form.sections.flatMap((s) => s.fields.filter((f) => isFieldActive(f, values)));
}

// --- File fields -------------------------------------------------------------
// A file field holds SEVERAL documents (Course Sequence sheet + DegreeWorks PDF).
// Stored as "name::id" per file, "||"-joined — the same multi-value format
// multi_select/course_picker use, so the draft, validation, summary and print paths
// need no special-casing. The id is what the backend stores the bytes under; the
// name is only for display.
const FILE_SEP = "||";
const NAME_ID_SEP = "::";

export function parseFileList(value) {
  if (!value) return [];
  return String(value)
    .split(FILE_SEP)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.lastIndexOf(NAME_ID_SEP);
      // Legacy drafts stored a bare id with no name; show the id rather than nothing.
      if (at === -1) return { name: part, id: part };
      return { name: part.slice(0, at), id: part.slice(at + NAME_ID_SEP.length) };
    });
}

export function serializeFileList(files) {
  return (files || [])
    .filter((f) => f && f.id)
    // Strip the separators out of the display name so a file called "a||b" can't
    // corrupt the encoding.
    .map((f) => `${String(f.name || f.id).split(FILE_SEP).join("/").split(NAME_ID_SEP).join("-")}${NAME_ID_SEP}${f.id}`)
    .join(FILE_SEP);
}

// The attached filenames, comma-separated, for anywhere a file field is shown to a
// human (the AI summary, the printed form, the read-only view). Without this the raw
// "name::id" pairs leak the internal storage ids into the output.
export function fileListLabel(value) {
  return parseFileList(value).map((f) => f.name).join(", ");
}
