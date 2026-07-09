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
import { GENED_COURSE_NAMES } from "./genEdCourses";

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

// Full catalog = CS/major/supporting courses + every official GenEd course. The CS
// list wins on the rare overlap (e.g. a course named on both a sequence sheet and
// the GenEd sheet) since its wording matches what the Planner/prereq engine use.
export const COURSE_CATALOG = { ...GENED_COURSE_NAMES, ...CS_COURSE_CATALOG };

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
