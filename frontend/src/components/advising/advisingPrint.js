// Browser print-to-PDF for the advising forms. No dependency: we open a clean,
// self-styled document in a new window and call print(); the student picks
// "Save as PDF" in the browser dialog. Only fields with a value are shown.
import { isFieldActive } from "../coding-tutor/advisingFormSchema";
import { courseLabel } from "../coding-tutor/courseCatalog";
import { fileListLabel } from "./formHelpers";

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("||", ", ");
}

// Course-picker values are stored as "||"-joined codes. In the printout, expand
// each to "CODE — Full Name" so the advisor reads real course names, not numbers.
function displayFieldValue(field, raw) {
  if (field.type === "course_picker") {
    return String(raw || "")
      .split("||").filter(Boolean)
      .map(courseLabel)
      .join(", ");
  }
  // File fields hold "name::id" pairs; print the filenames, never the storage ids.
  if (field.type === "file") return fileListLabel(raw);
  return esc(raw);
}

export function buildAdvisingPrintDoc(steps, valuesByForm) {
  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const formsHtml = steps.map((form) => {
    const values = valuesByForm[form.id] || {};
    const rows = [];
    for (const section of form.sections) {
      const secRows = section.fields
        .filter((f) => isFieldActive(f, values))
        .filter((f) => String(values[f.id] ?? "").trim() !== "")
        .map((f) => `<tr><th>${esc(f.label)}</th><td>${esc(displayFieldValue(f, values[f.id]))}</td></tr>`)
        .join("");
      if (secRows) {
        rows.push(`<tr class="sec"><td colspan="2">${esc(section.title)}</td></tr>${secRows}`);
      }
    }
    if (!rows.length) return "";  // skip an untouched form
    return `<section><h2>${esc(form.title)}</h2><table>${rows.join("")}</table></section>`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Advising Form</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #1a2438; margin: 40px; }
    header { border-bottom: 2px solid #1a2438; padding-bottom: 12px; margin-bottom: 20px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .meta { color: #555; font-size: 13px; }
    section { margin-bottom: 26px; page-break-inside: avoid; }
    h2 { font-size: 16px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 6px 8px; font-size: 13px; vertical-align: top; }
    th { width: 42%; font-weight: 600; color: #333; }
    td { color: #111; }
    tr.sec td { background: #f0ede6; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; padding-top: 10px; }
    tbody tr:not(.sec):nth-child(even) { background: #faf9f6; }
    @media print { body { margin: 16px; } }
  </style></head><body>
    <header>
      <h1>Morgan State University — CS Advising</h1>
      <div class="meta">Prepared ${esc(today)} · Draft for review — submit through the official Morgan form.</div>
    </header>
    ${formsHtml || "<p>No fields filled in yet.</p>"}
    <${"script"}>window.onload = function () { window.print(); };</${"script"}>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) {
    alert("Please allow pop-ups to download your advising form as a PDF.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
