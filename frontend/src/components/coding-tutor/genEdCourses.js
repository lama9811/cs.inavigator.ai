// Morgan State University — General Education Requirement (REV 06/07/17).
// The 40-credit GenEd program for students who matriculated Fall 2014 to present.
// Transcribed EXACTLY from the official "GENERAL EDUCATION REQUIREMENT" sheet.
//
// Structure: one entry per distribution area, keyed by its code (IM, EC, CT, MQ,
// AH, BP, SB, HH, CI). Each area lists its required credits, the selection rule,
// and every approved course with code + full name (+ credits/notes where the sheet
// specifies them). Course pickers and the course-name lookup read from here so a
// student filling a GenEd slot sees real, approved options — not just a code.
//
// Cross-count note (from the sheet): a course may satisfy identical requirements in
// up to two areas (e.g. GenEd + major), but its credits count once toward the 120.

export const GENED_AREAS = [
  {
    code: "IM",
    name: "Information, Technological and Media Literacy",
    credits: 3,
    rule: "Complete one of the options in the IM area.",
    courses: [
      { code: "COSC 110", name: "Introduction to Computers", credits: 3 },
      { code: "INSS 141", name: "Introduction to Computer-Based Information Systems", credits: 3 },
      { code: null, name: "Computer literacy course required by the major/discipline", credits: 3 },
    ],
  },
  {
    code: "EC",
    name: "English Composition",
    credits: 6,
    rule: "Select two courses: one from Part A and one from Part B. ENGL 101 is a prerequisite for ENGL 102; ENGL 111 for ENGL 112. Earn a C or better in both.",
    courses: [
      { code: "ENGL 101", name: "Freshman Composition I", credits: 3, part: "A" },
      { code: "ENGL 111", name: "Freshman Composition I Honors", credits: 3, part: "A" },
      { code: "ENGL 102", name: "Freshman Composition II", credits: 3, part: "B" },
      { code: "ENGL 112", name: "Freshman Composition II Honors", credits: 3, part: "B" },
    ],
  },
  {
    code: "CT",
    name: "Critical Thinking",
    credits: 3,
    rule: "Complete one of the options in the CT area.",
    courses: [
      { code: "ARCH 105", name: "Place Matters: Introduction to Contemporary City", credits: 3 },
      { code: "COMM 300", name: "Communication and the Black Diaspora", credits: 3 },
      { code: "MHTC 340", name: "Religious, Spirituality, and the Helping Tradition", credits: 3 },
      { code: "PHIL 109", name: "Introduction to Logic", credits: 3 },
      { code: "PHIL 119", name: "Introduction to Logic Honors", credits: 3 },
    ],
  },
  {
    code: "MQ",
    name: "Mathematics and Quantitative Reasoning",
    credits: 3,
    rule: "Must be MATH 109 or above. Select the appropriate course after advisement based on placement scores and major.",
    courses: [
      { code: "MATH 109", name: "Mathematics for Liberal Arts", credits: 4 },
      { code: "MATH 110", name: "Algebra, Functions, and Analytic Geometry", credits: 3 },
      { code: "MATH 113", name: "Introduction to Mathematics Analysis I", credits: "3-4" },
      { code: null, name: "MQ course required by the major/discipline", credits: "3-4" },
    ],
  },
  {
    code: "AH",
    name: "Arts and Humanities",
    credits: 6,
    rule: "Select two courses from different disciplines in the AH area.",
    courses: [
      { code: "ART 308", name: "The Visual Arts", credits: 3 },
      { code: "COMM 203", name: "Media Literacy in a Diverse World", credits: 3 },
      { code: "HUMA 201", name: "Introduction to Humanities I", credits: 3 },
      { code: "HUMA 211", name: "Introduction to Humanities I Honors", credits: 3 },
      { code: "HUMA 202", name: "Introduction to Humanities II", credits: 3 },
      { code: "HUMA 212", name: "Introduction to Humanities II Honors", credits: 3 },
      { code: "MISC 302", name: "Introduction to Military Training", credits: 3 },
      { code: "MUSC 391", name: "The World of Music", credits: 3 },
      { code: "PHEC 300", name: "Selected Roots of Afro-American Dance", credits: 3 },
      { code: "PHIL 220", name: "Ethics and Values", credits: 3 },
      { code: "PHIL 223", name: "Introduction to the Philosophy of Politics", credits: 3 },
      { code: "RELG 305", name: "Introduction to World Religions", credits: 3 },
      { code: "THEA 312", name: "Black Drama", credits: 3 },
      { code: null, name: "Foreign Language 102 or higher", credits: 3 },
    ],
  },
  {
    code: "BP",
    name: "Biological and Physical Sciences",
    credits: 7,
    rule: "Select two courses from the BP area. At least one must be lab-based (Part A).",
    courses: [
      // Part A — lab-based
      { code: "BIOL 101", name: "Introduction to Biology I", credits: 4, part: "A" },
      { code: "BIOL 102", name: "Introduction to Biology II", credits: 4, part: "A" },
      { code: "BIOL 105", name: "Introduction to Biology", credits: 4, part: "A" },
      { code: "BIOL 111", name: "Introduction to Biology I – Honors", credits: 4, part: "A" },
      { code: "BIOL 112", name: "Introduction to Biology II – Honors", credits: 4, part: "A" },
      { code: "CHEM 101", name: "General Chemistry I + Lab (with CHEM 101L)", credits: 4, part: "A" },
      { code: "CHEM 105", name: "General Chemistry I + Lab (with CHEM 105L)", credits: 4, part: "A" },
      { code: "CHEM 110", name: "General Chemistry for Engineers + Lab (with CHEM 110L)", credits: 4, part: "A" },
      { code: "CHEM 111", name: "General Chemistry – Honors + Lab (with CHEM 111L)", credits: 4, part: "A" },
      { code: "PHYS 101", name: "Introduction to Physics", credits: 4, part: "A" },
      { code: "PHYS 111", name: "Introduction to Physics – Honors", credits: 4, part: "A" },
      { code: "PHYS 203", name: "General Physics: Fundamentals of Physics I + Lab (with PHYS 203L)", credits: 4, part: "A" },
      { code: "PHYS 205", name: "University Physics + Lab (with PHYS 205L)", credits: 4, part: "A" },
      // Part B — non-lab
      { code: "EASC 101", name: "Stellar Astronomy", credits: 3, part: "B" },
      { code: "EASC 102", name: "Meteorology", credits: 3, part: "B" },
      { code: "EASC 201", name: "Physical Geology", credits: 3, part: "B" },
      { code: "EASC 202", name: "Historical Geology", credits: 3, part: "B" },
      { code: "EASC 203", name: "Mineralogy", credits: 3, part: "B" },
      { code: "EASC 301", name: "Planetary Science", credits: 3, part: "B" },
      { code: "GEOG 101", name: "Introduction to Geography", credits: 3, part: "B" },
      { code: "GEOG 104", name: "Introduction to Physical Geography", credits: 3, part: "B" },
      { code: "GEOG 105", name: "Introduction to Weather and Climate", credits: 3, part: "B" },
      { code: "PHYS 105", name: "Energy, Transportation, and Pollution I", credits: 3, part: "B" },
      { code: "PHYS 310", name: "Astronomy and Space Science", credits: 3, part: "B" },
      { code: "PHYS 311", name: "Acoustics and You", credits: 3, part: "B" },
      { code: "PHYS 408", name: "Introduction to Quantum Physics", credits: 3, part: "B" },
      { code: "TRSS 301", name: "Introduction to Transportation Systems", credits: 3, part: "B" },
    ],
  },
  {
    code: "SB",
    name: "Social and Behavioral Sciences",
    credits: 6,
    rule: "Select two courses from different disciplines in the SB area.",
    courses: [
      { code: "ECON 211", name: "Principles of Economics", credits: 3 },
      { code: "ECON 212", name: "Principles of Economics II", credits: 3 },
      { code: "HIST 101", name: "World History I", credits: 3 },
      { code: "HIST 102", name: "World History II", credits: 3 },
      { code: "HIST 105", name: "History of the United States I", credits: 3 },
      { code: "HIST 106", name: "History of the United States II", credits: 3 },
      { code: "HIST 111", name: "World History I – Honors", credits: 3 },
      { code: "HIST 112", name: "World History II – Honors", credits: 3 },
      { code: "HIST 115", name: "History of the United States I – Honors", credits: 3 },
      { code: "HIST 116", name: "History of the United States II – Honors", credits: 3 },
      { code: "HIST 120", name: "Introductory Seminar in American History", credits: 3 },
      { code: "HIST 130", name: "Introductory Seminar in World History", credits: 3 },
      { code: "MISC 301", name: "Introduction to Team and Small Unit Operations", credits: 3 },
      { code: "MHTC 103", name: "Introduction to Group Dynamics", credits: 3 },
      { code: "POSC 201", name: "American Government", credits: 3 },
      { code: "POSC 206", name: "Black Politics in America", credits: 3 },
      { code: "PSYC 101", name: "General Psychology", credits: 3 },
      { code: "PSYC 111", name: "General Psychology – Honors", credits: 3 },
      { code: "SOCI 101", name: "Introduction to Sociology", credits: 3 },
      { code: "SOCI 110", name: "Introduction to Anthropology", credits: 3 },
      { code: "SOSC 101", name: "Introduction to the Social Sciences", credits: 3 },
    ],
  },
  {
    code: "HH",
    name: "Health and Healthful Living",
    credits: 3,
    rule: "Complete one of the options in the HH area.",
    courses: [
      { code: "HEED 103", name: "Health Science: Human and Social Determinants", credits: 3 },
      { code: "HEED 203", name: "Personal and Community Health", credits: 3 },
      { code: "NUSC 160", name: "Introduction to Nutrition", credits: 3 },
    ],
  },
  {
    code: "CI",
    name: "Contemporary and Global Issues, Ideas and Values",
    credits: 3,
    rule: "Complete one of the options in the CI area.",
    courses: [
      { code: "HIST 350", name: "Introduction to the African Diaspora", credits: 3 },
      { code: "HIST 360", name: "Introduction to the African Diasporas – Honors", credits: 3 },
    ],
  },
];

// Flat { "COURSE CODE": "Full Name" } map of every GenEd course that has a real
// course code (placeholder rows like "Foreign Language 102 or higher" are skipped
// since they have no single code). Merged into the course catalog for name lookups.
export const GENED_COURSE_NAMES = GENED_AREAS.reduce((acc, area) => {
  for (const c of area.courses) {
    if (c.code) acc[c.code] = c.name;
  }
  return acc;
}, {});

// All GenEd course codes, deduped — handy for seeding a course picker's option list
// when a student is filling a GenEd slot.
export const GENED_COURSE_CODES = Object.keys(GENED_COURSE_NAMES);
