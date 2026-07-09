// Morgan State University academic MINORS — required-course roadmaps.
//
// Each entry maps a minor (by the name DegreeWorks reports) to its official
// requirements so the Curriculum page can show the minor's course roadmap and mark
// which ones the student has completed / has in progress / still needs.
//
// IMPORTANT: only add a minor here once its requirements are VERIFIED against an
// official Morgan source (catalog.morgan.edu / department page). A wrong course
// number is worse than an absent minor. Minors not listed here render as "name +
// note" with no course table — never the student's whole transcript.
//
// Shape:
//   "<lowercased minor name>": {
//     name: "Official Minor Name",
//     department: "Offering department",
//     credits: <total credits for the minor>,
//     source: "<url the requirements came from>",
//     verified: true | false,
//     courses: [
//       { code: "MATH 241", name: "Calculus I", credits: 4 },
//       { code: null, name: "Choose one 300+ MATH elective", credits: 3, note: "elective" },
//     ],
//   }
//
// `aliases` lets several DegreeWorks spellings resolve to one entry.

export const MINORS = {
  // ---- Criminal Justice (Dept. of Sociology & Anthropology) ----
  // Verified from the department page. It's a "choose 6 of these 14 SOCI courses"
  // minor — there are NO strictly-required courses, so every course is an elective
  // option. `chooseNote` tells the UI how many to pick.
  "criminal justice": {
    name: "Criminal Justice",
    department: "Sociology & Anthropology",
    credits: 18,
    chooseNote: "Students must choose six (6) courses (grade of C or better in each).",
    source: "https://www.morgan.edu/sociology-and-anthropology/undergraduate-programs/the-minor-in-criminal-justice",
    verified: true,
    courses: [
      { code: "SOCI 305", name: "Juvenile Justice and Delinquency", credits: 3 },
      { code: "SOCI 308", name: "Criminology", credits: 3 },
      { code: "SOCI 310", name: "Social Psychology", credits: 3 },
      { code: "SOCI 315", name: "Sociology of Law and Law Enforcement", credits: 3 },
      { code: "SOCI 330", name: "Sociology of Jails and Prisons", credits: 3 },
      { code: "SOCI 331", name: "Community-Based Corrections", credits: 3 },
      { code: "SOCI 332", name: "Law Enforcement, Policing and Society", credits: 3 },
      { code: "SOCI 401", name: "Forensic Anthropology", credits: 3 },
      { code: "SOCI 408", name: "Research Methods in Criminal Justice and Criminology", credits: 3 },
      { code: "SOCI 425", name: "Gender and Violence", credits: 3 },
      { code: "SOCI 429", name: "Victimology", credits: 3 },
      { code: "SOCI 430", name: "Sociology of Deviance", credits: 3 },
      { code: "SOCI 453", name: "Internship / Independent Research", credits: 3, note: "pre-approval required" },
    ],
  },

  // ---- Business Administration (Earl G. Graves School of Business) ----
  "business administration": {
    name: "Business Administration",
    department: "Earl G. Graves School of Business & Management",
    credits: 24,
    chooseNote: "15 credits required + 9 credits of electives (choose 3).",
    source: "https://www.morgan.edu/Documents/ACADEMICS/academic_catalog/undergrad/2016-2018/ucat_SBM.pdf",
    verified: true,
    courses: [
      { code: "ENTR 351", name: "Entrepreneurship", credits: 3 },
      { code: "BUAD 361", name: "Fundamentals of Risk Management", credits: 3 },
      { code: "BUAD 371", name: "Principles of Real Estate", credits: 3 },
      { code: "BUAD 382", name: "Business Law", credits: 3 },
      { code: "ENTR 384", name: "Entrepreneurial Opportunity Recognition", credits: 3 },
      { code: "BUAD 362", name: "Life and Health Insurance", credits: 3, note: "elective" },
      { code: "BUAD 456", name: "Special Topics in Business Administration", credits: 3, note: "elective" },
      { code: "ENTR 452", name: "Advanced Entrepreneurship", credits: 3, note: "elective" },
      { code: "BUAD 486", name: "Internship", credits: 3, note: "elective" },
    ],
  },

  // ---- Management (Earl G. Graves School of Business) ----
  management: {
    name: "Management",
    department: "Earl G. Graves School of Business & Management",
    credits: 24,
    chooseNote: "12 credits required + 12 credits of electives (choose 4).",
    source: "https://www.morgan.edu/Documents/ACADEMICS/academic_catalog/undergrad/2016-2018/ucat_SBM.pdf",
    verified: true,
    courses: [
      { code: "MGMT 329", name: "Human Resource Management", credits: 3 },
      { code: "MGMT 330", name: "Compensation and Benefits Management", credits: 3 },
      { code: "MGMT 421", name: "Training and Development", credits: 3 },
      { code: "MGMT 425", name: "Staffing and Performance Management", credits: 3 },
      { code: "ENTR 351", name: "Entrepreneurship", credits: 3, note: "elective" },
      { code: "ENTR 452", name: "Advanced Entrepreneurship", credits: 3, note: "elective" },
      { code: "BUAD 456", name: "Special Topics in Business Administration", credits: 3, note: "elective" },
      { code: "BUAD 486", name: "Internship and Field Experience", credits: 3, note: "elective" },
    ],
  },

  // ---- Computer Science (SCMNS) ----
  "computer science": {
    name: "Computer Science",
    department: "Computer Science (SCMNS)",
    credits: 18,
    chooseNote: "All five courses are required.",
    source: "https://catalog.morgan.edu/preview_program.php?catoid=26&poid=6078",
    verified: true,
    courses: [
      { code: "COSC 111", name: "Introduction to Computer Science I", credits: 4 },
      { code: "COSC 112", name: "Introduction to Computer Science II", credits: 4 },
      { code: "COSC 220", name: "Data Structures and Algorithms", credits: 4 },
      { code: "COSC 241", name: "Computer Systems and Digital Logic", credits: 3 },
      { code: "COSC 243", name: "Computer Architecture", credits: 3 },
    ],
  },

  // ---- Mathematics — General Track (SCMNS) ----
  // Two tracks; a student completes ONE based on their major type. Track A (for
  // science/engineering majors) jumps to upper-division since they already have
  // calculus; Track B (everyone else) is the calculus sequence. Both = 18 cr.
  mathematics: {
    name: "Mathematics (General Track)",
    department: "Mathematics (SCMNS)",
    credits: 18,
    chooseNote: "Complete ONE track (18 credits): Track A for science/engineering majors, or Track B for all other majors.",
    source: "https://catalog.morgan.edu/preview_program.php?catoid=26&poid=6080",
    verified: true,
    courses: [
      { code: "MATH 341", name: "Advanced Calculus I", credits: 3, note: "Track A" },
      { code: "MATH 343", name: "Complex Variables", credits: 3, note: "Track A" },
      { code: "MATH 413", name: "Algebraic Structures I", credits: 3, note: "Track A" },
      { code: "MATH 431", name: "Mathematical Theory of Statistics I", credits: 3, note: "Track A" },
      { code: "MATH 450", name: "Senior Seminar", credits: 3, note: "Track A" },
      { code: "MATH 479", name: "Point Set Topology", credits: 3, note: "Track A" },
      { code: "MATH 215", name: "Foundations for Advanced Mathematics I", credits: 3, note: "Track B" },
      { code: "MATH 241", name: "Calculus I", credits: 4, note: "Track B" },
      { code: "MATH 242", name: "Calculus II", credits: 4, note: "Track B" },
      { code: "MATH 243", name: "Calculus III", credits: 4, note: "Track B" },
      { code: "MATH 312", name: "Linear Algebra I", credits: 3, note: "Track B" },
    ],
  },

  // ---- Sociology (Dept. of Sociology & Anthropology) ----
  // 5 named required SOCI courses + 1 open SOCI elective. Per-course credits (3 ea)
  // inferred from the 6×3=18 structure (the dept page didn't print per-course cr).
  sociology: {
    name: "Sociology",
    department: "Sociology & Anthropology",
    credits: 18,
    chooseNote: "Five required courses + one Sociology (SOCI) elective. None may double-count toward your major.",
    source: "https://www.morgan.edu/sociology-and-anthropology/undergraduate-programs/the-minor-in-sociology",
    verified: true,
    courses: [
      { code: "SOCI 101", name: "Introduction to Sociology", credits: 3 },
      { code: "SOCI 205", name: "Contemporary Social Problems", credits: 3 },
      { code: "SOCI 302", name: "Social Theory", credits: 3 },
      { code: "SOCI 351", name: "Introduction to Social Statistics", credits: 3 },
      { code: "SOCI 380", name: "Methods of Social Research I", credits: 3 },
      { code: null, name: "Sociology elective (any additional SOCI course)", credits: 3, note: "elective" },
    ],
  },

  // ---- Physics (Dept. of Physics & Engineering Physics, SCMNS) ----
  // NOTE: distinct from the Engineering Physics minor. 3 required + 3 upper-level
  // PHYS electives (the dept page leaves the elective slots open, not enumerated).
  physics: {
    name: "Physics",
    department: "Physics & Engineering Physics",
    credits: 18,
    chooseNote: "3 required courses + 3 upper-level (300/400) PHYS electives.",
    source: "https://www.morgan.edu/physics-minor",
    verified: true,
    courses: [
      { code: "PHYS 300", name: "Modern Physics I", credits: 3 },
      { code: "PHYS 408", name: "Introduction to Quantum Mechanics", credits: 3 },
      { code: "PHYS 409", name: "Experimental Physics", credits: 3 },
      { code: null, name: "Upper-level Physics elective (PHYS 300/400)", credits: 3, note: "choose 3" },
      { code: null, name: "Upper-level Physics elective (PHYS 300/400)", credits: 3, note: "choose 3" },
      { code: null, name: "Upper-level Physics elective (PHYS 300/400)", credits: 3, note: "choose 3" },
    ],
  },

  // ---- Psychology (Dept. of Psychology) ----
  // PSYC 101 required + choose 3 from Group 1 + choose 2 from Group 2 (grade C+).
  psychology: {
    name: "Psychology",
    department: "Psychology",
    credits: 18,
    chooseNote: "PSYC 101 + choose 3 from Group 1 + choose 2 from Group 2 (grade of C or better).",
    source: "https://www.morgan.edu/psychology-minor",
    verified: true,
    courses: [
      { code: "PSYC 101", name: "General Psychology", credits: 3 },
      { code: "PSYC 102", name: "Developmental Psychology", credits: 3, note: "Group 1" },
      { code: "PSYC 108", name: "Scientific Method in Psychology", credits: 3, note: "Group 1" },
      { code: "PSYC 210", name: "Abnormal Psychology", credits: 3, note: "Group 1" },
      { code: "PSYC 213", name: "Theories of Personality", credits: 3, note: "Group 1" },
      { code: "PSYC 219", name: "History and Systems of Psychology", credits: 3, note: "Group 1" },
      { code: "PSYC 231", name: "Social Psychology", credits: 3, note: "Group 1" },
      { code: "PSYC 300", name: "Psychology of Learning", credits: 3, note: "Group 1" },
      { code: "PSYC 301", name: "Physiological Psychology", credits: 3, note: "Group 1" },
      { code: "PSYC 316", name: "Psychological Statistics I", credits: 3, note: "Group 1" },
      { code: "PSYC 317", name: "Psychological Statistics II", credits: 3, note: "Group 1" },
      { code: "PSYC 320", name: "Experimental Psychology I", credits: 3, note: "Group 1" },
      { code: "PSYC 322", name: "Psychology of Perception", credits: 3, note: "Group 1" },
      { code: "PSYC 205", name: "Psychology of Adjustment", credits: 3, note: "Group 2" },
      { code: "PSYC 209", name: "Applied Psychology", credits: 3, note: "Group 2" },
      { code: "PSYC 268", name: "The Psychology of Aging", credits: 3, note: "Group 2" },
      { code: "PSYC 306", name: "Psychology of Exceptional Children", credits: 3, note: "Group 2" },
      { code: "PSYC 310", name: "Health Psychology", credits: 3, note: "Group 2" },
      { code: "PSYC 312", name: "An Introduction to Behavioral Pharmacology", credits: 3, note: "Group 2" },
      { code: "PSYC 315", name: "Psychological Testing", credits: 3, note: "Group 2" },
      { code: "PSYC 319", name: "Psychological Counseling", credits: 3, note: "Group 2" },
      { code: "PSYC 368", name: "Death and Dying", credits: 3, note: "Group 2" },
      { code: "PSYC 405", name: "Black Psychology", credits: 3, note: "Group 2" },
    ],
  },

  // ---- Entrepreneurship (Earl G. Graves School of Business) ----
  entrepreneurship: {
    name: "Entrepreneurship",
    department: "Earl G. Graves School of Business & Management",
    credits: 27,
    chooseNote: "15 credits required + 12 credits of electives.",
    source: "https://www.morgan.edu/entrepreneurship-minor",
    verified: true,
    courses: [
      { code: "ENTR 351", name: "Entrepreneurship", credits: 3 },
      { code: "ENTR 353", name: "Social Entrepreneurship", credits: 3 },
      { code: "BUAD 382", name: "Business Law", credits: 3 },
      { code: "ENTR 384", name: "Entrepreneurial Opportunity Recognition", credits: 3 },
      { code: "ENTR 452", name: "Advanced Entrepreneurship", credits: 3 },
      { code: "BUAD 361", name: "Fundamentals of Risk Management", credits: 3, note: "elective" },
      { code: "BUAD 362", name: "Life and Health Insurance", credits: 3, note: "elective" },
      { code: "BUAD 371", name: "Principles of Real Estate", credits: 3, note: "elective" },
      { code: "ENTR 450", name: "Managing the Venture Financing Process", credits: 3, note: "elective" },
      { code: "ENTR 457", name: "Special Topics in Entrepreneurship", credits: 3, note: "elective" },
      { code: "FIN 344", name: "Investments", credits: 3, note: "elective" },
    ],
  },
};

// Alternate spellings/abbreviations DegreeWorks may report -> canonical key above.
export const MINOR_ALIASES = {
  "cyber security": "cybersecurity",
  math: "mathematics",
  "business": "business administration",
  "info systems": "information systems",
};

// Find the roadmap for a DegreeWorks minor name. Case-insensitive; tries the name
// directly, then aliases. Returns the plan object (with its key) or null when we
// don't have verified requirements for that minor yet.
export function findMinorPlan(rawName) {
  const key = String(rawName || "").trim().toLowerCase();
  if (!key) return null;
  const canonical = MINORS[key] ? key : MINOR_ALIASES[key];
  const plan = canonical ? MINORS[canonical] : null;
  return plan || null;
}
