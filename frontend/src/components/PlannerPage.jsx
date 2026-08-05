import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FaCalendarAlt } from "@react-icons/all-files/fa/FaCalendarAlt";
import { FaClock } from "@react-icons/all-files/fa/FaClock";
import { FaMapMarkerAlt } from "@react-icons/all-files/fa/FaMapMarkerAlt";
import { FaArrowRight } from "@react-icons/all-files/fa/FaArrowRight";
import { FaSync } from "@react-icons/all-files/fa/FaSync";
import { FaCheckCircle } from "@react-icons/all-files/fa/FaCheckCircle";
import { FaClipboardList } from "@react-icons/all-files/fa/FaClipboardList";
import { FaCopy } from "@react-icons/all-files/fa/FaCopy";
import { FaPrint } from "@react-icons/all-files/fa/FaPrint";
import { FaExternalLinkAlt } from "@react-icons/all-files/fa/FaExternalLinkAlt";
import { FaCommentDots } from "@react-icons/all-files/fa/FaCommentDots";
import { FaPaperPlane } from "@react-icons/all-files/fa/FaPaperPlane";
import { getApiBase } from "../lib/apiBase";
import { ADVISING_STEPS } from "./coding-tutor/advisingFormSchema";
import "./PlannerPage.css";

const API_BASE = getApiBase();
const OFFICIAL_ACADEMIC_CALENDAR_URL = "https://www.morgan.edu/academic-calendar";
const OFFICIAL_CALENDAR_DOCS = {
  "2025-2026": {
    label: "Fall 2025 - Summer 2026",
    url: "https://docs.google.com/document/d/12czwe1xFu7n9I2r-NeuvvtdV-EmtiKGNi3O9l2-tcnQ/edit?tab=t.0",
  },
  "2026-2027": {
    label: "Fall 2026 - Summer 2027",
    url: "https://docs.google.com/document/d/1KJSXV4I4JsMbGiPxRHTaLk22TpKZfOM4i66QjoEpXKQ/edit?tab=t.0",
  },
};

const CALENDAR_REMINDER_TYPES = [
  {
    key: "add_drop",
    label: "Last day to add/drop",
    description: "Schedule changes, late registration, or add/drop deadline.",
  },
  {
    key: "withdraw",
    label: "Last day to withdraw",
    description: "Deadline to withdraw from a 16-week course or term with a W.",
  },
];

const TIME_PREFS = [
  { key: "any", label: "Any time" },
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

const INTERESTS = [
  { key: "ai", label: "AI / ML" },
  { key: "security", label: "Security" },
  { key: "data", label: "Data" },
  { key: "web", label: "Web / Mobile" },
  { key: "game", label: "Games" },
  { key: "systems", label: "Systems" },
];

const ADVISING_HELP_FIELDS = ADVISING_STEPS
  .flatMap((form) => form.sections.flatMap((section) => section.fields))
  .filter((field) => field.freeWriting || [
    "career_interest",
    "clubs_and_organization_interests",
    "plan_to_work_next_semester",
    "degreeworks_requirements_fulfilled",
  ].includes(field.id))
  .map((field) => field.label);

const prettySemester = (key) =>
  !key ? "" : key.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

function academicYearForSemester(key) {
  const match = String(key || "").match(/^(fall|spring|summer)_(20\d{2})$/);
  if (!match) return null;
  const season = match[1];
  const year = Number(match[2]);
  if (!Number.isFinite(year)) return null;
  const startYear = season === "fall" ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function calendarLinkForSemester(key) {
  const academicYear = academicYearForSemester(key);
  const direct = academicYear ? OFFICIAL_CALENDAR_DOCS[academicYear] : null;
  return direct || { label: "Morgan academic calendar", url: OFFICIAL_ACADEMIC_CALENDAR_URL, fallback: true };
}

function yyyymmdd(dateValue) {
  return String(dateValue || "").replaceAll("-", "");
}

function nextCalendarDay(dateValue) {
  if (!dateValue) return "";
  const [year, month, day] = String(dateValue).split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return "";
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function formatCalendarDate(dateValue) {
  if (!dateValue) return "";
  const [year, month, day] = String(dateValue).split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function googleCalendarUrl({ title, date, details }) {
  const day = yyyymmdd(date);
  const endDay = yyyymmdd(nextCalendarDay(date));
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${day}/${endDay || day}`,
    details,
    ctz: "America/New_York",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function openGoogleCalendar(url) {
  if (!url) return false;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.assign(url);
    return false;
  }
  return true;
}

function downloadIcs({ title, date, details }) {
  const day = yyyymmdd(date);
  if (!day) return;
  const endDay = yyyymmdd(nextCalendarDay(date)) || day;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = `${day}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@csnavigator`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CS Navigator//Planner Advising//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${day}`,
    `DTEND;VALUE=DATE:${endDay}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${details.replace(/\r?\n/g, "\\n")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function CalendarReminderCard({ data }) {
  const [manualDates, setManualDates] = useState({});
  const [calendarData, setCalendarData] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const semesterLabel = prettySemester(data?.semester) || "Selected semester";
  const calendarLink = calendarData?.source || calendarLinkForSemester(data?.semester);
  const officialDeadlines = calendarData?.deadlines || {};

  useEffect(() => {
    if (!data?.semester) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    const controller = new AbortController();
    setManualDates({});
    setCalendarLoading(true);
    fetch(`${API_BASE}/api/planning/calendar-deadlines?semester=${encodeURIComponent(data.semester)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("calendar lookup failed"))))
      .then((payload) => setCalendarData(payload))
      .catch((error) => {
        if (error.name !== "AbortError") {
          setCalendarData({
            source: calendarLinkForSemester(data.semester),
            deadlines: {},
            status: "fetch_failed",
            message: "Could not load Morgan calendar dates right now.",
          });
        }
      })
      .finally(() => setCalendarLoading(false));
    return () => controller.abort();
  }, [data?.semester]);

  const eventDetails = (type) => [
    `${type.label} for ${semesterLabel}.`,
    `Confirm the deadline in Morgan State's official academic calendar before relying on it.`,
    `Official calendar: ${calendarLink.label} - ${calendarLink.url}`,
  ].join("\n");

  return (
    <div className="pl-advisor-card">
      <h3>Calendar reminders</h3>
      <p className="pl-advisor-copy">
        Add important registration deadlines to your calendar. If the exact date is not stored in CS Navigator yet,
        enter it from Morgan's official calendar first.
      </p>

      <div className="pl-reminder-list">
        {CALENDAR_REMINDER_TYPES.map((type) => {
          const officialDeadline = officialDeadlines[type.key];
          const officialDate = officialDeadline?.date;
          const selectedDate = officialDate || manualDates[type.key] || "";
          const title = `${semesterLabel}: ${type.label}`;
          const details = eventDetails(type);
          const calendarUrl = selectedDate ? googleCalendarUrl({ title, date: selectedDate, details }) : "";

          return (
            <div className="pl-reminder-row" key={type.key}>
              <div className="pl-reminder-copy">
                <strong>{type.label}</strong>
                <span>{type.description}</span>
                <small>
                  {calendarLoading
                    ? "Checking Morgan's official calendar..."
                    : officialDate
                      ? `From official calendar: ${formatCalendarDate(officialDate)}`
                      : calendarData?.message || "Enter the official date from Morgan's calendar."}
                </small>
              </div>
              <div className="pl-reminder-controls">
                {!officialDate && (
                  <input
                    type="date"
                    value={manualDates[type.key] || ""}
                    onChange={(event) => setManualDates((prev) => ({
                      ...prev,
                      [type.key]: event.target.value,
                    }))}
                    aria-label={`${type.label} date`}
                  />
                )}
                <button
                  type="button"
                  className={`pl-calendar-action ${selectedDate ? "" : "disabled"}`}
                  aria-disabled={!selectedDate}
                  disabled={!selectedDate}
                  onClick={() => {
                    openGoogleCalendar(calendarUrl);
                  }}
                >
                  Google Calendar
                </button>
                <button
                  type="button"
                  className="pl-calendar-action"
                  disabled={!selectedDate}
                  onClick={() => downloadIcs({ title, date: selectedDate, details })}
                >
                  Download .ics
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const escapeHtml = (text) => String(text || "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[ch]));

// "2026-07-02T18:00:00+00:00" -> "2h ago" for the live-seats freshness badge.
const relTime = (iso) => {
  if (!iso) return "just now";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

// Per-section availability label from the backend's `availability` + seat count.
const SEAT_LABEL = {
  open: (c) => `${c.seats_available ?? ""} seat${c.seats_available === 1 ? "" : "s"}`.trim(),
  waitlist: () => "Waitlist",
  full: () => "Full",
};

function courseLine(course) {
  const bits = [
    `${course.code}${course.section ? `-${course.section}` : ""}`,
    course.name,
    `${course.credits} cr`,
  ];
  if (course.time) bits.push(course.time);
  if (course.room && course.room !== "TBA") bits.push(course.room);
  if (course.satisfies) bits.push(`satisfies ${course.satisfies}`);
  if (course.availability && course.availability !== "unknown") bits.push(`seat status: ${course.availability}`);
  if (course.untimed) bits.push("pick section in WEBSIS");
  return bits.filter(Boolean).join(" | ");
}

function buildAdvisorPacket(option, data) {
  if (!option) return "";
  const calendarLink = calendarLinkForSemester(data?.semester);
  const courseLines = option.courses.map((course) => `- ${courseLine(course)}`).join("\n");
  const notes = (data?.notes || []).map((note) => `- ${note}`).join("\n");
  const unlocks = option.courses
    .filter((course) => course.unlocks?.length)
    .map((course) => `- ${course.code} may unlock ${course.unlocks.slice(0, 3).join(", ")}${course.unlocks.length > 3 ? "..." : ""}`)
    .join("\n");

  return [
    "Advisor Prep Packet",
    `Semester: ${prettySemester(data?.semester)}`,
    `Plan: ${option.label}`,
    `Total credits: ${option.total_credits}`,
    `DegreeWorks sync basis: ${data?.credits_remaining ?? "unknown"} credits remaining; ${data?.classification || "classification unknown"}`,
    "",
    "Proposed courses:",
    courseLines || "- No courses selected yet.",
    "",
    "Planner notes:",
    notes || "- No planner notes.",
    "",
    "Future-course impact:",
    unlocks || "- No specific unlock notes in this plan.",
    "",
    "Reminder:",
    "Submit or update Morgan State's official advising form/process, then meet with your advisor for final approval and PIN release.",
    `Official academic calendar: ${calendarLink.label} - ${calendarLink.url}`,
  ].join("\n");
}

function PlannerReviewHelper({ selectedOption, packetText, selectedInterests = [] }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const token = localStorage.getItem("token");
  const starters = [
    "Why was this plan recommended?",
    "What happens if I delay one class?",
    "Can I make this semester lighter?",
    "Help me write my career goals.",
    "Help me explain how my experience connects to CS.",
  ];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const ask = async (text) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setLoading(true);

    const interestText = selectedInterests.length ? selectedInterests.join(", ") : "none selected";
    const framed =
      `You are a Morgan State CS pre-advising assistant. Help the student review a planner-generated schedule before they meet their advisor. ` +
      `You are not the final authority for approval, PIN release, substitutions, or registration. ` +
      `You can also help them understand or draft short wording for fields from Morgan's official advising/internship paperwork, especially career interest, career goals, presentation details, relevance of experience, and explanations for courses that do not fulfill a DegreeWorks requirement. ` +
      `Do not invent personal facts, companies, dates, grades, internships, research, or approvals. If the student asks for wording, ask for missing details when needed and give an editable draft or sentence structure based only on their stated facts, selected interests, and plan context. ` +
      `Use plain text only. Do not use Markdown, bold markers, headings, tables, or decorative formatting because this chat renders helper replies as plain text. ` +
      `For form-writing questions, do not append a generic advisor approval reminder; just provide the wording help. ` +
      `For schedule planning or registration questions, be concise, flag uncertainty, and remind the student to confirm final choices with their advisor and the official school process when needed.\n\n` +
      `Selected interests from Planner: ${interestText}\n` +
      `Relevant advising form fields: ${ADVISING_HELP_FIELDS.join("; ")}\n\n` +
      `Selected plan context:\n${packetText || "No selected plan yet."}\n\n` +
      `Student question: ${q}`;

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          query: framed,
          display_query: q,
          session_id: "planner-advising-helper",
          mode: "regular",
        }),
      });
      const payload = res.ok ? await res.json() : null;
      const reply = (payload?.response || "").trim() || "I could not review that just now. Try again in a moment.";
      setMessages((prev) => [...prev, { role: "bot", text: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "bot", text: "I'm having trouble connecting right now. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="pl-advisor-chat" aria-label="Advising helper">
      <div className="pl-advisor-chat-head">
        <FaCommentDots size={16} />
        <div>
          <strong>Advising Helper</strong>
          <p>Ask about your selected plan or wording for advising form answers.</p>
        </div>
      </div>
      <div className="pl-advisor-chat-scroll">
        {messages.length === 0 && (
          <div className="pl-advisor-starters">
            {starters.map((starter) => (
              <button key={starter} type="button" onClick={() => ask(starter)} disabled={!selectedOption || loading}>
                {starter}
              </button>
            ))}
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`pl-advisor-msg ${message.role}`}>{message.text}</div>
        ))}
        {loading && <div className="pl-advisor-msg bot">Thinking...</div>}
        <div ref={endRef} />
      </div>
      <form className="pl-advisor-input-row" onSubmit={(event) => { event.preventDefault(); ask(); }}>
        <input
          value={input}
          placeholder="Ask about this plan..."
          onChange={(event) => setInput(event.target.value)}
          disabled={loading || !selectedOption}
        />
        <button type="submit" disabled={loading || !selectedOption || !input.trim()} aria-label="Send">
          <FaPaperPlane size={14} />
        </button>
      </form>
    </aside>
  );
}

function AdvisorPrep({ data, selectedOption, packetActionStatus, selectedInterests = [] }) {
  const packetText = useMemo(() => buildAdvisorPacket(selectedOption, data), [selectedOption, data]);
  const calendarLink = calendarLinkForSemester(data?.semester);
  const checklist = [
    { label: "DegreeWorks data is connected and current", done: Boolean(data?.connected) },
    { label: "Pick the schedule option you plan to discuss", done: Boolean(selectedOption) },
    { label: "Review prerequisites, repeated courses, seats, and TBA sections", done: Boolean(selectedOption) },
    { label: "Copy or print the advisor packet from a schedule card", done: packetActionStatus === "Copied" || packetActionStatus === "Print opened" },
    { label: "Submit or update Morgan State's official advising form/process", done: false },
    { label: "Meet with your advisor and confirm PIN/release steps", done: false },
  ];

  return (
    <section className="pl-advisor-hub" aria-label="Advisor prep">
      <div className="pl-advisor-main">
        <div className="pl-advisor-card pl-advisor-intro">
          <div className="pl-advisor-title">
            <FaClipboardList size={18} />
            <div>
              <h2>Advisor Prep</h2>
              <p>Use Planner to prepare, then submit the official Morgan form and meet your advisor for approval.</p>
            </div>
          </div>
          <div className="pl-advisor-intro-actions">
            <a href={calendarLink.url} target="_blank" rel="noreferrer" className="pl-calendar-link">
              {calendarLink.fallback ? "Official academic calendar" : calendarLink.label} <FaExternalLinkAlt size={11} />
            </a>
            {packetActionStatus && <div className="pl-copy-status">{packetActionStatus}</div>}
          </div>
        </div>

        <div className="pl-advisor-grid">
          <div className="pl-advisor-card">
            <h3>Checklist</h3>
            <ul className="pl-checklist">
              {checklist.map((item) => (
                <li key={item.label} className={item.done ? "done" : ""}>
                  <span className="pl-check-dot">{item.done ? <FaCheckCircle size={13} /> : ""}</span>
                  {item.label}
                </li>
              ))}
            </ul>
          </div>

          <CalendarReminderCard data={data} />
        </div>

      </div>
      <PlannerReviewHelper
        selectedOption={selectedOption}
        packetText={packetText}
        selectedInterests={selectedInterests}
      />
    </section>
  );
}

export default function PlannerPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Controls
  const [semester, setSemester] = useState("");
  const [timePref, setTimePref] = useState("any");
  const [maxCredits, setMaxCredits] = useState(15);
  const [interests, setInterests] = useState([]);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [packetActionStatus, setPacketActionStatus] = useState("");
  // Regenerate cycles this to rotate the GenEd/minor picks (CS courses come from the
  // interests selector, not the variant). Any control change resets it to 0.
  const [variant, setVariant] = useState(0);

  const fetchPlan = useCallback((overrides = {}) => {
    const token = localStorage.getItem("token");
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError("");
    const sem = overrides.semester ?? semester;
    // A regenerate passes its own variant; any other control change resets to 0.
    const nextVariant = overrides.variant ?? 0;
    if (nextVariant !== variant) setVariant(nextVariant);
    const params = new URLSearchParams({
      time_pref: overrides.timePref ?? timePref,
      max_credits: String(overrides.maxCredits ?? maxCredits),
      interests: (overrides.interests ?? interests).join(","),
      variant: String(nextVariant),
    });
    if (sem) params.set("semester", sem);
    fetch(`${API_BASE}/api/planning/next-semester?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load your plan"))))
      .then((d) => {
        setData(d);
        if (d.semester && !semester) setSemester(d.semester);
      })
      .catch((e) => setError(e.message || "Something went wrong"))
      .finally(() => setLoading(false));
  }, [semester, timePref, maxCredits, interests, variant]);

  const regenerate = () => fetchPlan({ variant: variant + 1 });

  useEffect(() => { fetchPlan(); /* initial */ // eslint-disable-next-line
  }, []);

  const toggleInterest = (key) => {
    const next = interests.includes(key)
      ? interests.filter((i) => i !== key)
      : [...interests, key];
    setInterests(next);
    fetchPlan({ interests: next });
  };

  const onSemester = (val) => { setSemester(val); fetchPlan({ semester: val }); };
  const onTimePref = (val) => { setTimePref(val); fetchPlan({ timePref: val }); };
  const onCredits = (val) => { setMaxCredits(val); fetchPlan({ maxCredits: val }); };

  const options = useMemo(() => data?.options || [], [data]);
  const selectedOption = useMemo(
    () => options.find((option) => option.label === selectedLabel) || options[0] || null,
    [options, selectedLabel],
  );

  const copyPacket = async (option) => {
    const packetText = buildAdvisorPacket(option, data);
    if (!packetText) return;
    try {
      await navigator.clipboard.writeText(packetText);
      setSelectedLabel(option.label);
      setPacketActionStatus("Copied");
    } catch {
      setPacketActionStatus("Copy failed");
    }
  };

  const printPacket = (option) => {
    const packetText = buildAdvisorPacket(option, data);
    if (!packetText) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setPacketActionStatus("Allow pop-ups to print");
      return;
    }
    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Advisor Prep Packet</title>
          <style>
            @page { margin: 0.6in; }
            body {
              font-family: Arial, sans-serif;
              color: #10233f;
              line-height: 1.45;
              margin: 0;
            }
            h1 {
              font-size: 20px;
              margin: 0 0 16px;
            }
            pre {
              white-space: pre-wrap;
              overflow-wrap: anywhere;
              font-family: inherit;
              font-size: 13px;
              margin: 0;
            }
          </style>
        </head>
        <body>
          <h1>Advisor Prep Packet</h1>
          <pre>${escapeHtml(packetText)}</pre>
        </body>
      </html>`;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);
    setSelectedLabel(option.label);
    setPacketActionStatus("Print opened");
  };

  useEffect(() => {
    if (!options.length) {
      setSelectedLabel("");
      return;
    }
    if (!options.some((option) => option.label === selectedLabel)) {
      setSelectedLabel(options[0].label);
    }
  }, [options, selectedLabel]);

  if (loading && !data) {
    return (
      <div className="pl"><div className="pl-center"><FaSync className="pl-spin" size={20} /><p>Building your plan…</p></div></div>
    );
  }

  if (data && data.connected === false) {
    return (
      <div className="pl">
        <div className="pl-center">
          <FaCalendarAlt size={40} className="pl-empty-icon" />
          <h2>Connect DegreeWorks to plan</h2>
          <p className="pl-muted">
            The planner needs your completed courses and remaining requirements to suggest what to take next.
          </p>
          <button className="pl-primary-btn" onClick={() => navigate("/profile")}>
            <FaSync size={13} /> Connect in Profile
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pl">
      <header className="pl-head">
        <div>
          <h1>Next-Semester Planner</h1>
          <span className="pl-muted">
            Conflict-free schedules for <strong>{prettySemester(data?.semester)}</strong> — only courses you're eligible for.
          </span>
        </div>
        {data?.data_source && (
          <span
            className={`pl-live-badge ${data.data_source === "live" ? "live" : "static"}`}
            title={
              data.data_source === "live"
                ? "Seat counts pulled live from Banner"
                : "Seat counts aren't live — confirm open seats in Banner before registering"
            }
          >
            {data.data_source === "live" ? (
              <>● Live seats · updated {relTime(data.as_of)}</>
            ) : (
              <>Availability not live — verify in Banner</>
            )}
          </span>
        )}
      </header>

      {data?.registered_term && (
        <div className={`pl-registered-note ${data.registered_term.no_later_schedule ? "warning" : ""}`}>
          <strong>{data.registered_term.term}</strong> registration detected from Banner
          {data.registered_term.skipped_default
            ? "; showing the next available planning term."
            : data.registered_term.no_later_schedule
              ? "; no later schedule data is available yet."
              : data.registered_term.is_selected_term
                ? "; use this term to review or compare alternatives."
                : "."}
        </div>
      )}

      {/* Controls */}
      <div className="pl-controls">
        <label className="pl-control">
          <span>Semester</span>
          <select value={semester} onChange={(e) => onSemester(e.target.value)}>
            {(data?.available_semesters || []).map((s) => (
              <option key={s} value={s}>{prettySemester(s)}</option>
            ))}
          </select>
        </label>

        <label className="pl-control">
          <span>Time of day</span>
          <select value={timePref} onChange={(e) => onTimePref(e.target.value)}>
            {TIME_PREFS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>

        <label className="pl-control">
          <span>Max credits: {maxCredits}</span>
          <input type="range" min={9} max={18} value={maxCredits}
                 onChange={(e) => setMaxCredits(Number(e.target.value))}
                 onMouseUp={(e) => onCredits(Number(e.target.value))}
                 onTouchEnd={(e) => onCredits(Number(e.target.value))} />
        </label>

        <div className="pl-control pl-interests">
          <span>Interests</span>
          <div className="pl-chips">
            {INTERESTS.map((i) => (
              <button key={i.key} type="button"
                className={`pl-chip ${interests.includes(i.key) ? "on" : ""}`}
                onClick={() => toggleInterest(i.key)}>
                {i.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pl-control pl-regen-control">
          <button
            type="button"
            className="pl-regen-link"
            onClick={regenerate}
            disabled={loading}
            title="Show a different mix of GenEd/minor courses"
          >
            <FaSync size={12} className={loading ? "pl-spin" : ""} />
            {loading ? "Building…" : "Regenerate"}
          </button>
        </div>
      </div>

      {error && <div className="pl-error">{error}</div>}

      {/* Options */}
      {options.length === 0 ? (
        <div className="pl-empty-note">
          No schedule could be built for {prettySemester(data?.semester)} with these settings.
          Try a different semester or raise the credit limit.
        </div>
      ) : (
        <div className="pl-options">
          {options.map((opt) => (
            <div key={opt.label} className="pl-option-card">
              <div className="pl-option-head">
                <h3>{opt.label}</h3>
                <div className="pl-option-head-actions">
                  <button type="button" onClick={() => copyPacket(opt)}>
                    <FaCopy size={12} /> Copy packet
                  </button>
                  <button type="button" onClick={() => printPacket(opt)}>
                    <FaPrint size={12} /> Print packet
                  </button>
                  <span className="pl-credits">{opt.total_credits} cr</span>
                </div>
              </div>
              <div className="pl-courses">
                {opt.courses.map((c) => (
                  <div key={c.code + (c.section || "")} className={`pl-course${c.untimed ? " untimed" : ""}`}>
                    <div className="pl-course-top">
                      <span className="pl-code">{c.code}</span>
                      <span className="pl-course-credits">{c.credits} cr</span>
                    </div>
                    <div className="pl-course-name">{c.name}</div>
                    {c.untimed ? (
                      // GenEd/minor course blended into the plan — no class time yet.
                      <>
                        <div className="pl-course-meta">
                          <span className="pl-pick-time"><FaClock size={11} /> Pick your section in WEBSIS</span>
                        </div>
                        <div className="pl-course-tags">
                          <span className={`pl-tag ${c.kind === "minor" ? "minor" : "gened"}`}>
                            {c.satisfies}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="pl-course-meta">
                          {c.availability && c.availability !== "unknown" && (
                            <span className={`pl-seat ${c.availability}`}>
                              {(SEAT_LABEL[c.availability] || (() => c.availability))(c)}
                            </span>
                          )}
                          <span><FaClock size={11} /> {c.time}</span>
                          {c.room && c.room !== "TBA" && <span><FaMapMarkerAlt size={11} /> {c.room}</span>}
                        </div>
                        {c.instructor && <div className="pl-course-instr">{c.instructor}</div>}
                        <div className="pl-course-tags">
                          {c.satisfies && (
                            <span className="pl-tag satisfies"><FaCheckCircle size={10} /> {c.satisfies}</span>
                          )}
                          {c.unlocks && c.unlocks.length > 0 && (
                            <span className="pl-tag unlocks">
                              <FaArrowRight size={10} /> unlocks {c.unlocks.slice(0, 2).join(", ")}
                              {c.unlocks.length > 2 ? ` +${c.unlocks.length - 2}` : ""}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {data?.notes?.length > 0 && (
        <div className="pl-notes">
          {data.notes.map((n, i) => <span key={i}>· {n}</span>)}
        </div>
      )}

      <AdvisorPrep
        data={data}
        selectedOption={selectedOption}
        packetActionStatus={packetActionStatus}
        selectedInterests={INTERESTS.filter((interest) => interests.includes(interest.key)).map((interest) => interest.label)}
      />
    </div>
  );
}
