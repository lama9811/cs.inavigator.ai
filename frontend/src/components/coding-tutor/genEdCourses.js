// Morgan State University — General Education Requirement (40 credits).
// Verified against the official catalog General Education Requirements page
// (catalog.morgan.edu, catoid=28 navoid=2075) — course lists reconciled to match it.
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
      { code: "COSC 110", name: "Introduction to Computing", credits: 3 },
      { code: "INSS 141", name: "Digital Literacy and Application Software", credits: 3 },
      { code: null, name: "Computer literacy course required by the major/discipline", credits: 3 },
    ],
  },
  {
    code: "EC",
    name: "English Composition",
    credits: 6,
    rule: "Select two courses: one from Part A and one from Part B. ENGL 101 is a prerequisite for ENGL 102; ENGL 111 for ENGL 112. Earn a C or better in both.",
    courses: [
      { code: "ENGL 101", name: "Composition I", credits: 3, part: "A" },
      { code: "ENGL 111", name: "Composition I — Honors", credits: 3, part: "A" },
      { code: "ENGL 102", name: "Composition II", credits: 3, part: "B" },
      { code: "ENGL 112", name: "Composition II — Honors", credits: 3, part: "B" },
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
      { code: "ENGR 110", name: "Engineering for Us All", credits: 3 },
      { code: "MHTC 340", name: "Spirituality and the Helping Tradition", credits: 3 },
      { code: "PHIL 109", name: "Critical Thinking", credits: 3 },
      { code: "PHIL 119", name: "Critical Thinking — Honors", credits: 3 },
    ],
  },
  {
    code: "MQ",
    name: "Mathematics and Quantitative Reasoning",
    credits: 3,
    rule: "Must be MATH 109 or above. Select the appropriate course after advisement based on placement scores and major.",
    courses: [
      { code: "MATH 109", name: "Mathematics for the Liberal Arts", credits: 4 },
      { code: "MATH 110", name: "Algebra, Functions, and Analytic Geometry", credits: 3 },
      { code: "MATH 113", name: "Introduction to Mathematical Analysis I", credits: "3-4" },
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
      { code: "ENGL 347", name: "Women Writers in Africa and the Diaspora", credits: 3 },
      { code: "HUMA 201", name: "Introduction to Humanities I", credits: 3 },
      { code: "HUMA 211", name: "Introduction to Humanities I — Honors", credits: 3 },
      { code: "HUMA 202", name: "Introduction to Humanities II", credits: 3 },
      { code: "HUMA 212", name: "Introduction to Humanities II — Honors", credits: 3 },
      { code: "HUMA 301", name: "Contemporary Humanities", credits: 3 },
      { code: "MISC 302", name: "Introduction to Military Training Management", credits: 3 },
      { code: "MUSC 391", name: "The World of Music", credits: 3 },
      { code: "PHEC 300", name: "Selected Roots of Afro-American Dance", credits: 3 },
      { code: "PHIL 102", name: "The Big Questions", credits: 3 },
      { code: "PHIL 220", name: "The Good Life", credits: 3 },
      { code: "PHIL 223", name: "Introduction to the Philosophy of Politics", credits: 3 },
      { code: "RELG 305", name: "Introduction to World Religions", credits: 3 },
      { code: "THEA 210", name: "History of the Theatre I", credits: 3 },
      { code: "THEA 312", name: "Black Drama and Performance", credits: 3 },
      { code: "WGST 301", name: "Understanding Feminist Theory", credits: 3 },
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
      { code: "BIOL 101", name: "Introductory Biology I", credits: 4, part: "A" },
      { code: "BIOL 102", name: "Introductory Biology II", credits: 4, part: "A" },
      { code: "BIOL 103", name: "Introductory Biology", credits: 4, part: "A" },
      { code: "BIOL 105", name: "Introductory Biology for Majors I", credits: 4, part: "A" },
      { code: "BIOL 106", name: "Introductory Biology for Majors II", credits: 4, part: "A" },
      { code: "BIOL 111", name: "Foundations in Biology I", credits: 4, part: "A" },
      { code: "BIOL 112", name: "Foundations in Biology II", credits: 4, part: "A" },
      { code: "CHEM 101", name: "General Chemistry (with CHEM 101L lab)", credits: 4, part: "A" },
      { code: "CHEM 105", name: "Principles of General Chemistry I (with CHEM 105L lab)", credits: 4, part: "A" },
      { code: "CHEM 110", name: "General Chemistry for Engineering Students (with CHEM 110L lab)", credits: 4, part: "A" },
      { code: "CHEM 111", name: "General Chemistry — Honors (with CHEM 111L lab)", credits: 4, part: "A" },
      { code: "CHEM 112", name: "General Chemistry and Qualitative Analysis — Honors (with CHEM 112L lab)", credits: 4, part: "A" },
      { code: "EASC 205", name: "Introductory Earth Science", credits: 4, part: "A" },
      { code: "PHYS 101", name: "Introduction to Physics", credits: 4, part: "A" },
      { code: "PHYS 111", name: "Introduction to Physics", credits: 4, part: "A" },
      { code: "PHYS 203", name: "General Physics: Fundamentals of Physics I (with PHYS 203L lab)", credits: 4, part: "A" },
      { code: "PHYS 205", name: "University Physics I (with PHYS 205L lab)", credits: 4, part: "A" },
      { code: "PHYS 206", name: "University Physics II (with PHYS 206L lab)", credits: 4, part: "A" },
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
      { code: "PHYS 105", name: "Energy and Environment: Planet in Balance I", credits: 3, part: "B" },
      { code: "PHYS 310", name: "Astronomy and Space Science", credits: 3, part: "B" },
      { code: "PHYS 311", name: "Acoustics and You", credits: 3, part: "B" },
      { code: "PHYS 408", name: "Introduction to Quantum Mechanics", credits: 3, part: "B" },
      { code: "TRSS 301", name: "Introduction to Transportation Systems", credits: 3, part: "B" },
    ],
  },
  {
    code: "SB",
    name: "Social and Behavioral Sciences",
    credits: 6,
    rule: "Select two courses from different disciplines in the SB area.",
    courses: [
      { code: "ECON 211", name: "Principles of Economics I", credits: 3 },
      { code: "ECON 212", name: "Principles of Economics II", credits: 3 },
      { code: "HIST 101", name: "World History I", credits: 3 },
      { code: "HIST 102", name: "World History II", credits: 3 },
      { code: "HIST 105", name: "History of the United States I", credits: 3 },
      { code: "HIST 106", name: "History of the United States II", credits: 3 },
      { code: "HIST 111", name: "World History I, Honors", credits: 3 },
      { code: "HIST 112", name: "World History II, Honors", credits: 3 },
      { code: "HIST 115", name: "History of the United States I, Honors", credits: 3 },
      { code: "HIST 116", name: "History of the United States II, Honors", credits: 3 },
      { code: "HIST 120", name: "Topics in American History", credits: 3 },
      { code: "HIST 130", name: "Topics in World History", credits: 3 },
      { code: "HIST 140", name: "Introduction to African American History", credits: 3 },
      { code: "MISC 301", name: "Introduction to Team and Small Unit Operations", credits: 3 },
      { code: "MHTC 103", name: "Introduction to Group Dynamics", credits: 3 },
      { code: "POSC 201", name: "American National Government", credits: 3 },
      { code: "POSC 206", name: "Black Politics in America", credits: 3 },
      { code: "PSYC 101", name: "General Psychology", credits: 3 },
      { code: "PSYC 111", name: "Honors General Psychology", credits: 3 },
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
      { code: "HLTH 103", name: "Social and Behavioral Health Theory Applications", credits: 3 },
      { code: "HLTH 200", name: "Discovering Public Health", credits: 3 },
      { code: "HLTH 203", name: "Personal and Community Health", credits: 3 },
      { code: "HLTH 300", name: "Environmental Health Citizenship", credits: 3 },
      { code: "NUSC 160", name: "Introduction to Nutrition", credits: 3 },
    ],
  },
  {
    code: "CI",
    name: "Contemporary and Global Issues, Ideas and Values",
    credits: 3,
    rule: "Complete one of the options in the CI area.",
    courses: [
      { code: "AFST 350", name: "Africana Studies", credits: 3 },
      { code: "HIST 350", name: "Introduction to the African Diaspora", credits: 3 },
      { code: "HIST 360", name: "Introduction to the African Diaspora, Honors", credits: 3 },
      { code: "MENA 100", name: "Introduction to Middle East and North Africa Studies", credits: 3 },
      { code: "WGST 201", name: "Women's and Gender Studies", credits: 3 },
    ],
  },
];

// Foreign/world-language courses that satisfy the AH "Foreign Language 102 or higher"
// option. The catalog GenEd page lists that as a single placeholder rather than
// enumerating courses, so these live here (not inline in the AH area, which would
// swamp it) but ARE merged into the catalog below so a student can search "Spanish"
// or "SPAN 203" and pick the real course. Verified from the Dept. of World Languages
// & International Studies pages (morgan.edu/world-languages-and-international-studies).
// Only 102-and-above are included (101 doesn't satisfy the requirement).
export const GENED_LANGUAGE_COURSES = {
  // Spanish
  "SPAN 102": "Elementary Spanish II", "SPAN 105": "Intensive Elementary Spanish II",
  "SPAN 203": "Intermediate Spanish I", "SPAN 204": "Intermediate Spanish II",
  "SPAN 206": "Intensive Intermediate Spanish II", "SPAN 207": "Special Topics in Spanish I",
  "SPAN 208": "Special Topics in Spanish II", "SPAN 209": "Spanish for the Health Professions",
  "SPAN 305": "Latin-American Literature", "SPAN 306": "Latin-American Literature II",
  "SPAN 307": "Business Spanish", "SPAN 311": "Advanced Spanish Conversation and Composition I",
  "SPAN 312": "Advanced Spanish Conversation and Composition II",
  "SPAN 313": "Hispanic Folklore and Literature for Children",
  "SPAN 315": "Survey of Spanish Literature I", "SPAN 316": "Survey of Spanish Literature II",
  "SPAN 317": "Spanish Civilization I", "SPAN 318": "Spanish Civilization II",
  "SPAN 320": "Black Writers of Spanish Expression", "SPAN 321": "Women Writers of Hispanic Africa",
  "SPAN 322": "Career Spanish for the Service Professions I",
  "SPAN 323": "Career Spanish for the Service Professions II",
  "SPAN 413": "Latin American Society Through Film and Literature",
  "SPAN 420": "Translating and Interpreting Spanish I", "SPAN 421": "Translating and Interpreting Spanish II",
  "SPAN 450": "Special Topics in Spanish",
  // French
  "FREN 102": "Elementary French II", "FREN 105": "Intensive Elementary French II",
  "FREN 203": "Intermediate French I", "FREN 204": "Intermediate French II",
  "FREN 206": "Intensive Intermediate French II", "FREN 207": "Special Topics in French I",
  "FREN 208": "Special Topics in French II", "FREN 307": "Business French",
  "FREN 311": "Advanced French Conversation and Composition I",
  "FREN 312": "Advanced French Conversation and Composition II",
  "FREN 315": "Survey of French Literature I", "FREN 316": "Survey of French Literature II",
  "FREN 317": "French Civilization I", "FREN 318": "French Civilization II",
  "FREN 320": "Black Writers of French Expression", "FREN 322": "Francophone Caribbean Literature",
  "FREN 401": "Senior Seminar", "FREN 403": "Classical French Literature",
  "FREN 404": "Classical French Theatre", "FREN 411": "Advanced French Syntax and Stylistics I",
  "FREN 412": "Advanced French Syntax and Stylistics II",
  "FREN 413": "Francophone African Society Through Film and Literature",
  "FREN 420": "Translating and Interpreting French I", "FREN 421": "Translating and Interpreting French II",
  "FREN 450": "Special Topics in French",
  // German
  "GERM 102": "Elementary German II", "GERM 105": "Intensive Elementary German",
  "GERM 203": "Intermediate German I", "GERM 204": "Intermediate German II",
  "GERM 206": "Intensive Intermediate German", "GERM 307": "Business German",
  "GERM 311": "Advanced German Conversation and Composition I",
  "GERM 312": "Advanced German Conversation and Composition II",
  "GERM 315": "Survey of German Literature I", "GERM 316": "Survey of German Literature II",
  "GERM 317": "German Civilization I", "GERM 318": "German Civilization II",
  "GERM 411": "Advanced German Syntax and Stylistics I",
  "GERM 412": "Advanced German Syntax and Stylistics II",
  "GERM 420": "Translating and Interpreting German I", "GERM 421": "Translating and Interpreting German II",
  "GERM 450": "Special Topics in German",
  // Arabic
  "ARAB 102": "Elementary Arabic II", "ARAB 105": "Intensive Elementary Arabic",
  "ARAB 203": "Intermediate Arabic I", "ARAB 204": "Intermediate Arabic II",
  "ARAB 206": "Intensive Intermediate Arabic",
  // Chinese
  "CHNS 102": "Elementary Chinese II",
  // Italian
  "ITAL 102": "Elementary Italian II", "ITAL 203": "Intermediate Italian I",
  "ITAL 204": "Intermediate Italian II",
  // Latin
  "LATN 102": "Elementary Latin II", "LATN 203": "Intermediate Latin I", "LATN 204": "Intermediate Latin II",
  // Portuguese
  "PORT 102": "Elementary Portuguese II",
  // African languages / Swahili / Yoruba
  "AFLA 102": "Elementary African Language II", "AFLA 105": "Intensive Elementary African Language",
  "AFLA 203": "Intermediate African Language I", "AFLA 204": "Intermediate African Language II",
  "AFLA 206": "Intensive Intermediate African Language",
  "SWAL 102": "Elementary Swahili II", "SWAL 105": "Intensive Elementary Swahili",
  "SWAL 203": "Intermediate Swahili I", "SWAL 204": "Intermediate Swahili II",
  "SWAL 206": "Intensive Intermediate Swahili",
  "YORU 102": "Elementary Yoruba II",
};

// Flat { "COURSE CODE": "Full Name" } map of every GenEd course that has a real
// course code (placeholder rows like "Foreign Language 102 or higher" are skipped
// since they have no single code). Includes the world-language courses so they
// resolve + search. Merged into the course catalog for name lookups.
export const GENED_COURSE_NAMES = GENED_AREAS.reduce((acc, area) => {
  for (const c of area.courses) {
    if (c.code) acc[c.code] = c.name;
  }
  return acc;
}, { ...GENED_LANGUAGE_COURSES });

// All GenEd course codes, deduped — handy for seeding a course picker's option list
// when a student is filling a GenEd slot.
export const GENED_COURSE_CODES = Object.keys(GENED_COURSE_NAMES);
