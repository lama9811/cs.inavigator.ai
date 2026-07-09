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
