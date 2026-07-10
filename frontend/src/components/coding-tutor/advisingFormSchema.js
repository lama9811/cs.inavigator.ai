// Schema for the Advising section forms. Data-driven: the AdvisingPage renderer
// builds all fields, dropdowns, conditionals, and validation from this — no
// hardcoded field JSX. Mirrors backend/services/advising_form.py so the two agree.
//
// Field types: text | number | choice | multi_choice | multi_select | yes_no |
// yes_no_maybe | date | course_picker | file.
//   - course_picker: multi-select dropdown seeded with suggested courses (from the
//     Planner) PLUS a text box to type in any course code the list doesn't have.
//     Stored as a "||"-joined string, same as multi_select.
//   - date: native date input (mm/dd/yyyy).
//   - file: file upload; the chosen file is sent to POST /api/advising/upload and
//     the returned filename is stored in the draft.
// A field with `requiredWhen` only shows (and is only required) when the trigger
// field's value matches — `value` for one match, `values` for any-of.
// `prefillKey` marks fields that pre-fill from the student's DegreeWorks/profile data.

// Build a list of term labels (e.g. "Spring 2026") for the semester dropdowns.
// Advising only runs Fall -> Spring and Spring -> Fall, so Summer and Winter are
// NOT advising terms and are left out. Static (no Date.now) so options render
// the same every time.
const TERMS = ["Spring", "Fall"];
const semesterList = (startYear, endYear) => {
  const out = [];
  for (let year = startYear; year <= endYear; year += 1) {
    for (const t of TERMS) out.push(`${t} ${year}`);
  }
  return out;
};

// Current / upcoming advising terms: 2025 onward.
export const SEMESTER_OPTIONS = semesterList(2025, 2029);

// "First semester at MSU" is historical, so it goes back further (still Fall/Spring).
export const ENROLLMENT_SEMESTER_OPTIONS = semesterList(2020, 2029);

// -------------------- Step 1: Internship / Research / Job Experience --------------------
export const INTERNSHIP_FORM = {
  id: "internship_form",
  title: "Internship, Research & Job Experience Form",
  subtitle: "Academic Year 2025/2026 — Step 1 of advising",
  sections: [
    {
      id: "student_profile",
      title: "Student profile",
      fields: [
        { id: "first_name", label: "First Name", type: "text", required: true, prefillKey: "first_name" },
        { id: "last_name", label: "Last Name", type: "text", required: true, prefillKey: "last_name" },
        { id: "gender", label: "Gender", type: "choice", required: true, options: ["Male", "Female", "Non Binary"] },
        {
          id: "major", label: "Major", type: "choice", required: true, prefillKey: "major",
          options: [
            "Actuarial Science", "Biology", "Coastal Science and Policy", "Chemistry",
            "Cloud Computing", "Computer Science", "Engineering Physics", "Mathematics",
            "Medical Laboratory Science", "Physics",
          ],
        },
        { id: "transfer_student", label: "Are you a transfer student?", type: "yes_no", required: true },
        {
          id: "clubs_and_organization_interests", label: "SCMNS Clubs or Organization Interests",
          type: "multi_select", required: true,
          options: [
            "Not Interested in any SCMNS Clubs", "Astronomy Club", "Biology Club",
            "Chemistry Club", "Math Club", "Medical Laboratory Science Club",
            "POWER - SCMNS Black Male Initiative", "PreDental Society", "PreMed Program",
            "Society of Physics Students", "Rocket Club",
            "Society for the Advancement of Computer Science", "Women in Computer Science",
          ],
        },
        {
          id: "career_interest", label: "Career Interest", type: "choice", required: true,
          options: [
            "Analyst", "Cosmetic Chemist", "Dentist", "Developer", "Environmental Scientist",
            "Marine Scientist", "Medical Doctor", "Pharmacist", "Researcher", "Scientist",
            "Teacher", "Unsure of Career Interest", "Vet", "Other",
          ],
        },
        { id: "knows_graduate_programs", label: "Did you know that SCMNS has graduate programs?", type: "yes_no", required: true },
        { id: "want_on_campus_research", label: "Would you like to conduct research on campus?", type: "yes_no_maybe", required: true },
      ],
    },
    {
      id: "experience_summary",
      title: "Internship, research, and job experience",
      fields: [
        { id: "did_present_research_this_year", label: "Did you present research this academic year?", type: "yes_no", required: true },
        { id: "number_of_presentations_completed", label: "Number of research presentations completed", type: "number", requiredWhen: { field: "did_present_research_this_year", value: "Yes" } },
        { id: "presentation_details", label: "Presentation details", type: "text", freeWriting: true, hint: "Type, title, conference, location, and date for each.", requiredWhen: { field: "did_present_research_this_year", value: "Yes" } },
        { id: "had_publication_this_year", label: "Did you have a publication this academic year?", type: "yes_no", required: true },
        { id: "publication_title", label: "Title of Publication", type: "text", requiredWhen: { field: "had_publication_this_year", value: "Yes" } },
        { id: "publication_date", label: "Publication Date", type: "text", requiredWhen: { field: "had_publication_this_year", value: "Yes" } },
        { id: "publication_location", label: "Location", type: "text", requiredWhen: { field: "had_publication_this_year", value: "Yes" } },
        { id: "participated_in_experience", label: "Participated in Internship/Rsch/Job in 2025/2026?", type: "choice", required: true, options: ["Yes", "I did not apply", "I applied but was not selected"] },
        { id: "experience_type", label: "Type of Experience", type: "choice", options: ["STEM Internship", "STEM Related Job", "STEM Research", "Non STEM Internship", "Non STEM Job", "Non STEM Research"], requiredWhen: { field: "participated_in_experience", value: "Yes" } },
        { id: "experience_sector", label: "Sector of Internship/Job Experience", type: "choice", options: ["College/University", "Government Agency", "Private Industry"], requiredWhen: { field: "participated_in_experience", value: "Yes" } },
        { id: "organization_name", label: "Name of company, government agency, or institution", type: "text", requiredWhen: { field: "participated_in_experience", value: "Yes" } },
        { id: "job_title", label: "Your Intern/Job Title", type: "text", requiredWhen: { field: "participated_in_experience", value: "Yes" } },
        { id: "program_name", label: "Name of Program (e.g. Emory SURP program)", type: "text", requiredWhen: { field: "experience_type", values: ["STEM Research", "Non STEM Research"] } },
        { id: "mentor_name", label: "Research Mentor's First and Last Name", type: "text", requiredWhen: { field: "experience_type", values: ["STEM Research", "Non STEM Research"] } },
        { id: "address", label: "Address", type: "text", hint: "City and State", requiredWhen: { field: "participated_in_experience", value: "Yes" } },
        { id: "relevance_to_education", label: "Relevance of Experience to Your Education", type: "text", freeWriting: true, requiredWhen: { field: "participated_in_experience", value: "Yes" } },
        { id: "science_math_enhancement", label: "Enhanced Science or Math Education", type: "yes_no", requiredWhen: { field: "participated_in_experience", value: "Yes" } },
        { id: "permanent_job_future_career_prep", label: "Permanent Job or Future Career Preparation", type: "yes_no", requiredWhen: { field: "participated_in_experience", value: "Yes" } },
        { id: "had_second_experience", label: "Did you have a second internship/research/job?", type: "yes_no", required: true },
        { id: "second_experience_type", label: "Type of Experience (2)", type: "choice", options: ["STEM Internship", "STEM Related Job", "STEM Research", "Non STEM Internship", "Non STEM Job", "Non STEM Research"], requiredWhen: { field: "had_second_experience", value: "Yes" } },
        { id: "second_experience_sector", label: "Sector of Internship/Job Experience (2)", type: "choice", options: ["College/University", "Government Agency", "Private Industry"], requiredWhen: { field: "had_second_experience", value: "Yes" } },
        { id: "second_organization_name", label: "Name of company, government agency, or institution (2)", type: "text", requiredWhen: { field: "had_second_experience", value: "Yes" } },
        { id: "second_job_title", label: "Your Intern/Job Title (2)", type: "text", requiredWhen: { field: "had_second_experience", value: "Yes" } },
        { id: "second_program_name", label: "Name of Program (2)", type: "text", requiredWhen: { field: "second_experience_type", values: ["STEM Research", "Non STEM Research"] } },
        { id: "second_mentor_name", label: "Research Mentor's First and Last Name (2)", type: "text", requiredWhen: { field: "second_experience_type", values: ["STEM Research", "Non STEM Research"] } },
        { id: "second_address", label: "Address (2)", type: "text", requiredWhen: { field: "had_second_experience", value: "Yes" } },
        { id: "second_relevance_to_education", label: "Relevance of Experience to Your Education (2)", type: "text", freeWriting: true, requiredWhen: { field: "had_second_experience", value: "Yes" } },
        { id: "second_science_math_enhancement", label: "Enhanced Science or Math Education (2)", type: "yes_no", requiredWhen: { field: "had_second_experience", value: "Yes" } },
        { id: "second_permanent_job_future_career_prep", label: "Permanent Job or Future Career Preparation (2)", type: "yes_no", requiredWhen: { field: "had_second_experience", value: "Yes" } },
      ],
    },
  ],
};

// -------------------- Step 2: Academic Advising Form --------------------
// Rebuilt to match the REAL live Morgan SCMNS Academic Advisement Form (from the
// student's screenshots), in the same 4 sections and order. The form's note says
// advisor / SID / classification / GPA are added automatically — our DegreeWorks
// prefill covers those, so they're shown as locked prefill fields.
//
// COURSE_MAJORS: the Major/Minor dropdown list (shared with the internship form's
// major list, kept here so this file is self-contained).
const MAJORS = [
  "Actuarial Science", "Biology", "Chemistry", "Cloud Computing", "Computer Science",
  "Engineering Physics", "Information Technology", "Mathematics",
  "Medical Laboratory Science", "Physics",
];

export const ADVISING_FORM = {
  id: "advising_form",
  title: "Academic Advising Form",
  subtitle: "Step 2 of advising — plan your next semester",
  sections: [
    {
      id: "student_info",
      title: "Student information",
      fields: [
        { id: "first_name", label: "First Name", type: "text", required: true, prefillKey: "first_name" },
        { id: "last_name", label: "Last Name", type: "text", required: true, prefillKey: "last_name" },
        { id: "major", label: "Major", type: "choice", required: true, options: MAJORS, prefillKey: "major" },
        { id: "minor", label: "Minor", type: "choice", options: MAJORS, prefillKey: "minor" },
        { id: "first_semester_at_msu", label: "What was your first semester at MSU?", type: "choice", required: true, options: ENROLLMENT_SEMESTER_OPTIONS },
        { id: "expected_graduation_date", label: "Expected Graduation Date", type: "date" },
        {
          id: "total_credits_earned", label: "Total Credits Earned", type: "number", required: true,
          prefillKey: "credits_earned",
          hint: "Credits EARNED, not credits applied. In-progress DegreeWorks courses are applied, not yet earned.",
        },
        { id: "plan_to_work_next_semester", label: "Do you plan to work next semester?", type: "yes_no", required: true },
      ],
    },
    {
      id: "course_schedule",
      title: "Course Schedule (current semester)",
      fields: [
        { id: "current_semester", label: "Current Semester", type: "choice", required: true, options: SEMESTER_OPTIONS },
        {
          id: "registered_courses", label: "Select all registered courses", type: "course_picker", required: true,
          seedSource: "registered",
          hint: "Include withdrawn courses. BE SURE TO ADD LABS. Search or type a course code to add one that isn't listed.",
        },
        { id: "current_total_credits", label: "Total Credits", type: "number", required: true },
      ],
    },
    {
      id: "upcoming_semesters",
      title: "Upcoming Semesters",
      fields: [
        {
          id: "summer_winter_courses", label: "Summer / Winter course(s) you'd like to take", type: "course_picker",
          seedSource: "planner",
          hint: "Optional. Search or type a course code to add one.",
        },
        { id: "new_semester", label: "New Semester", type: "choice", required: true, options: SEMESTER_OPTIONS },
        {
          id: "upcoming_courses", label: "Select all courses you would like to take", type: "course_picker", required: true,
          seedSource: "planner",
          hint: "Suggestions from your Planner are pinned to the top. Search or type any course to add it.",
        },
        { id: "upcoming_total_credits", label: "New Courses Total Credits", type: "number", required: true },
      ],
    },
    {
      id: "graduation_checkpoint",
      title: "On-time Graduation Check Point",
      // Downloadable official curriculum-sequence sheets the student attaches with
      // their DegreeWorks PDF. Served from /public/docs. Shown above the upload field.
      references: [
        { label: "Computer Science — Curriculum Sequence (PDF)", href: "/docs/computer-science-curriculum-sequence.pdf" },
        { label: "Cloud Computing — Curriculum Sequence (PDF)", href: "/docs/cloud-computing-curriculum-sequence.pdf" },
      ],
      fields: [
        {
          id: "degreeworks_requirements_fulfilled",
          label: "Were DegreeWorks requirements fulfilled?", type: "yes_no", required: true,
          hint: "Do your selected courses fulfill the items highlighted RED in DegreeWorks?",
        },
        {
          id: "non_curricular_explanation",
          label: "Explanation for any course that doesn't fulfill a DegreeWorks requirement",
          type: "text",
          requiredWhen: { field: "degreeworks_requirements_fulfilled", value: "No" },
        },
        {
          id: "document_upload", label: "Upload Course Sequence + DegreeWorks PDF", type: "file", required: true,
          accept: ".pdf,.png,.jpg,.jpeg",
          hint: "Your form is returned without review if the wrong documents are attached.",
        },
      ],
    },
  ],
};

export const ADVISING_STEPS = [INTERNSHIP_FORM, ADVISING_FORM];

// Back-compat: the chat-panel prototype (AdvisingFormPanel.jsx) consumes a flat
// list of the Step-2 advising fields. Derive it from ADVISING_FORM so there is one
// source of truth. `optional` is the inverse of `required` for that panel's API.
export const ADVISING_FIELDS = ADVISING_FORM.sections
  .flatMap((s) => s.fields)
  .map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    hint: f.hint,
    options: f.options,
    optional: !f.required,
  }));

// Count how many fields a form has that are currently visible/required given the
// answers so far (used for the progress meter). Conditional fields only count when
// their trigger condition is met.
export function isFieldActive(field, values) {
  const rw = field.requiredWhen;
  if (!rw) return true;
  const trigger = String(values[rw.field] ?? "").trim().toLowerCase();
  if (!trigger) return false;
  if (rw.value != null) return trigger === String(rw.value).toLowerCase();
  if (rw.values) return rw.values.some((v) => trigger === String(v).toLowerCase());
  return false;
}
