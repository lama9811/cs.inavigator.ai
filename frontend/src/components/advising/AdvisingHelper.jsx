import { useState, useRef, useEffect } from "react";
import { FaCommentDots } from "@react-icons/all-files/fa/FaCommentDots";
import { FaPaperPlane } from "@react-icons/all-files/fa/FaPaperPlane";
import { getApiBase } from "../../lib/apiBase";

const API_BASE = getApiBase();

// A field-helper chat panel beside the advising form. It EXPLAINS fields and
// SUGGESTS wording — it never fills the form (the form stays the source of truth).
// Each question is sent to /chat with the current form's field list as context so
// "what do I put here?" is answered specifically, not generically. Uses a dedicated
// session id so it doesn't clutter the student's main chat history.

// Starters differ by which step the student is on. The internship form is about
// wording; the advising form is where next-semester course selection happens, so it
// gets a "suggest courses" starter that taps the student's curriculum + Planner.
const INTERNSHIP_STARTERS = [
  "What should I write for my career goals?",
  "What does “relevance of experience” mean?",
  "Help me phrase my presentation details.",
];
const ADVISING_STARTERS = [
  "Which courses should I take next semester?",
  "Do my picks satisfy my DegreeWorks requirements?",
  "What prerequisites am I missing?",
];

// Build a compact context line describing the form the student is on, so the
// agent can answer field questions specifically.
function formContext(form) {
  const fields = form.sections
    .flatMap((s) => s.fields)
    .map((f) => f.label)
    .join("; ");
  return `The student is filling out the "${form.title}" (${form.subtitle}). Its fields are: ${fields}.`;
}

export default function AdvisingHelper({ form, courseSuggestions = [] }) {
  // The advising form (Step 2) is the one where course selection happens.
  const isAdvisingForm = form.id === "advising_form";
  const STARTERS = isAdvisingForm ? ADVISING_STARTERS : INTERNSHIP_STARTERS;
  const [messages, setMessages] = useState([]);   // {role: 'user'|'bot', text}
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const token = localStorage.getItem("token");

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const ask = async (text) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setLoading(true);

    // Prompt frames the assistant as a form helper: explain + suggest wording, and
    // (on the advising form) recommend next-semester courses. It never fills the form
    // itself — the student still enters everything. The backend injects the student's
    // DegreeWorks + curriculum context, so course advice is grounded, not invented.
    let framed =
      `You are helping a Morgan State CS student fill out an advising form. ` +
      `${formContext(form)} ` +
      `Answer their question by EXPLAINING the relevant field or SUGGESTING how to word an answer. ` +
      `Do NOT claim to fill the form for them and do NOT invent personal facts (GPA, real internships). ` +
      `Keep it short and practical.`;

    // On the advising form, enable grounded course-selection help.
    if (isAdvisingForm) {
      const seeded = courseSuggestions.length
        ? `The Planner already suggests these eligible next-semester courses: ${courseSuggestions.join(", ")}. `
        : "";
      framed +=
        ` This is the course-planning step. When they ask about next-semester courses, you MAY recommend specific courses. ` +
        `${seeded}` +
        `Base recommendations ONLY on the student's curriculum context (completed and in-progress courses) that the system provides — ` +
        `never on transcript guesses. Recommend courses that satisfy prerequisites (using completed + in-progress courses), ` +
        `advance outstanding DegreeWorks/curriculum requirements, and fit their goals. ` +
        `Never recommend a course they have already completed or are currently taking. ` +
        `For each recommendation give a one-line reason (requirement fit, prerequisite status, or goal fit). ` +
        `Remind them to enter their final picks in the form themselves.`;
    }

    framed += `\n\nStudent question: ${q}`;

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: framed, display_query: q, session_id: "advising-helper", mode: "regular" }),
      });
      const data = res.ok ? await res.json() : null;
      const reply = (data?.response || "").trim() || "Sorry, I couldn't get an answer just now. Try again in a moment.";
      setMessages((m) => [...m, { role: "bot", text: reply }]);
    } catch {
      setMessages((m) => [...m, { role: "bot", text: "I'm having trouble connecting right now. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="advising-helper" aria-label="Advising form helper">
      <div className="ah-head">
        <FaCommentDots size={16} />
        <div>
          <strong>Need help?</strong>
          <p>
            {isAdvisingForm
              ? "Ask about any field, or ask which courses to take next semester — I use your DegreeWorks and completed courses. You still fill the form."
              : "Ask about any field. I explain what's needed and help you word answers — you fill the form."}
          </p>
        </div>
      </div>

      <div className="ah-scroll">
        {messages.length === 0 && (
          <div className="ah-starters">
            {STARTERS.map((s) => (
              <button key={s} type="button" className="ah-starter" onClick={() => ask(s)}>{s}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ah-msg ${m.role}`}>{m.text}</div>
        ))}
        {loading && <div className="ah-msg bot ah-typing">Thinking…</div>}
        <div ref={endRef} />
      </div>

      <form
        className="ah-input-row"
        onSubmit={(e) => { e.preventDefault(); ask(); }}
      >
        <input
          className="ah-input"
          value={input}
          placeholder="Ask about a field…"
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="ah-send" disabled={loading || !input.trim()} aria-label="Send">
          <FaPaperPlane size={14} />
        </button>
      </form>
    </aside>
  );
}
