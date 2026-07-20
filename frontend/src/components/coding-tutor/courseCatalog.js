// Course code -> full course name lookup, so the advising form and course pickers
// can show "COSC 349 — Computer Networks" instead of a bare code. Students often
// don't recognize a course by number alone.
//
// Sources (kept in sync by hand, small and stable):
//   1. backend/data_sources/classes.json — the 44 CS/major + supporting courses the
//      Planner and prereq engine already use (COSC/MATH/CLCO/INSS/EEGR).
//   2. The two official Curriculum Sequence sheets (Computer Science, Cloud
//      Computing) — adds the shared foundation courses those sheets name (ENGL,
//      ORNS, MGBU, extra MATH/CLCO) that classes.json doesn't carry.
//   3. genEdCourses.js — the full official General Education approved-course list
//      (all 9 distribution areas). Merged in below so GenEd courses resolve too.
//   4. minorsData.js — every real course across the transcribed minors, so minor
//      courses show up in the advising course picker too.
import { GENED_COURSE_NAMES } from "./genEdCourses";
import { MINOR_COURSE_NAMES } from "../minorsData";

const CS_COURSE_CATALOG = {
  // --- Math / supporting ---
  "MATH 113": "Intro to Mathematical Analysis I",
  "MATH 114": "Introduction to Mathematical Analysis II",
  "MATH 141": "Calculus I",
  "MATH 241": "Calculus I",
  "MATH 242": "Calculus II",
  "MATH 312": "Linear Algebra I",
  "MATH 313": "Linear Algebra II",
  "MATH 331": "Applied Probability and Statistics",

  // --- English / orientation / business (from sequence sheets) ---
  "ENGL 101": "Freshman Composition I",
  "ENGL 102": "Freshman Composition II",
  "ORNS 106": "Freshman Orientation for SCMNS Majors",
  "MGBU 200": "Intro to Business (Non-Business Majors)",
  "FIN 101": "Financial Literacy",

  // --- Computer Science core + electives ---
  "COSC 111": "Introduction to Computer Science I",
  "COSC 112": "Introduction to Computer Science II",
  "COSC 201": "Computer Ethics",
  "COSC 220": "Data Structures and Algorithms",
  "COSC 238": "Object Oriented Programming",
  "COSC 239": "Java Programming",
  "COSC 241": "Computer Systems and Digital Logic",
  "COSC 243": "Computer Architecture",
  "COSC 251": "Introduction to Data Science",
  "COSC 281": "Discrete Structures",
  "COSC 320": "Algorithm Design and Analysis",
  "COSC 323": "Introduction to Cryptography",
  "COSC 332": "Introduction to Game Design and Development",
  "COSC 338": "Mobile App Design and Development",
  "COSC 349": "Computer Networks",
  "COSC 351": "Cybersecurity",
  "COSC 352": "Organization of Programming Languages",
  "COSC 354": "Operating Systems",
  "COSC 383": "Numerical Methods and Programming",
  "COSC 385": "Theory of Languages and Automata",
  "COSC 386": "Introduction to Quantum Computing",
  "COSC 458": "Software Engineering",
  "COSC 459": "Database Design",
  "COSC 460": "Computer Graphics",
  "COSC 470": "Artificial Intelligence",
  "COSC 472": "Introduction to Machine Learning",
  "COSC 480": "Introduction to Image Processing and Analysis",
  "COSC 486": "Applied Quantum Computing",
  "COSC 490": "Senior Project",
  "COSC 491": "Conference Course",
  "COSC 498": "Senior Internship",
  "COSC 499": "Senior Research or Teaching/Tutorial Assistantship",

  // --- Cloud Computing ---
  "CLCO 261": "Introduction to Cloud Computing",
  "CLCO 401": "Cloud Application",
  "CLCO 471": "Data Analytics in Cloud",
  "CLCO 490": "Senior Project in Cloud Computing",

  // --- Information systems / electrical (electives) ---
  "INSS 391": "IT Infrastructure and Security",
  "INSS 494": "Information Security and Risk Management",
  "EEGR 317": "Electronic Circuits",
  "EEGR 481": "Introduction to Network Security",
  "EEGR 483": "Introduction to Security Management",
};

// Full catalog = GenEd + CS/major/supporting + minor courses. The CS list wins on
// the rare overlap (e.g. a course named on both a sequence sheet and the GenEd sheet)
// since its wording matches what the Planner/prereq engine use.
export const COURSE_CATALOG = { ...MINOR_COURSE_NAMES, ...GENED_COURSE_NAMES, ...CS_COURSE_CATALOG };

// Which advising-form group a course belongs to, mirroring how the paper form is laid
// out: General Education, then the CS curriculum, then Minor courses. A course in more
// than one list is attributed to the first that claims it in that order (GenEd > CS >
// Minor), so e.g. a SOCI course used by both a GenEd area and a minor reads as GenEd.
export const COURSE_GROUP = { GENED: "General Education", CS: "CS Curriculum", MINOR: "Minor Courses" };
function groupForCode(code) {
  if (GENED_COURSE_NAMES[code]) return COURSE_GROUP.GENED;
  if (CS_COURSE_CATALOG[code]) return COURSE_GROUP.CS;
  if (MINOR_COURSE_NAMES[code]) return COURSE_GROUP.MINOR;
  return COURSE_GROUP.CS;
}

// Normalize a code the way the course picker stores it ("cosc349" / "COSC  349"
// -> "COSC 349") so the lookup is forgiving of how a student typed it.
export function normalizeCourseCode(raw) {
  const s = String(raw || "").trim().toUpperCase().replace(/\s+/g, " ");
  // Insert a space between letters and digits if the student omitted it.
  return s.replace(/^([A-Z]{2,5})\s*(\d.*)$/, "$1 $2");
}

// Look up a full course name. Returns "" if the code isn't in the catalog (e.g. a
// GenEd course we don't carry), so callers can fall back to showing just the code.
export function courseName(code) {
  return COURSE_CATALOG[normalizeCourseCode(code)] || "";
}

// Format a code with its name for display: "COSC 349 — Computer Networks", or just
// "COSC 349" when the name is unknown.
export function courseLabel(code) {
  const c = normalizeCourseCode(code);
  const name = COURSE_CATALOG[c];
  return name ? `${c} — ${name}` : c;
}

// Order the groups the way the advising form lays courses out.
const GROUP_ORDER = [COURSE_GROUP.GENED, COURSE_GROUP.CS, COURSE_GROUP.MINOR];

// Every catalog course as { code, name, label, group } — the searchable list behind
// the course pickers. Codes are already normalized ("COSC 349"). Sorted by group
// (GenEd -> CS -> Minor, following the form) then by code within each group.
export const CATALOG_COURSES = Object.entries(COURSE_CATALOG)
  .map(([code, name]) => ({ code, name, label: `${code} — ${name}`, group: groupForCode(code) }))
  .sort((a, b) => {
    const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    return g !== 0 ? g : a.code.localeCompare(b.code);
  });

// Filter the catalog by a free-text query, matching either the code or the name
// (case-insensitive). Empty query returns the whole list. Used by the picker search.
export function searchCatalog(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return CATALOG_COURSES;
  return CATALOG_COURSES.filter(
    (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
  );
}

// The catalog course for a code (with its group), or null. Lets the picker label a
// course's section even when it came from a pinned seed rather than a search hit.
export function catalogEntry(code) {
  const c = normalizeCourseCode(code);
  const name = COURSE_CATALOG[c];
  return name ? { code: c, name, label: `${c} — ${name}`, group: groupForCode(c) } : null;
}
