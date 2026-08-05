import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FaCalendarAlt } from "@react-icons/all-files/fa/FaCalendarAlt";
import { FaClock } from "@react-icons/all-files/fa/FaClock";
import { FaMapMarkerAlt } from "@react-icons/all-files/fa/FaMapMarkerAlt";
import { FaArrowRight } from "@react-icons/all-files/fa/FaArrowRight";
import { FaSync } from "@react-icons/all-files/fa/FaSync";
import { FaCheckCircle } from "@react-icons/all-files/fa/FaCheckCircle";
import { FaClipboardList } from "@react-icons/all-files/fa/FaClipboardList";
import { FaPrint } from "@react-icons/all-files/fa/FaPrint";
import { FaExternalLinkAlt } from "@react-icons/all-files/fa/FaExternalLinkAlt";
import { FaCommentDots } from "@react-icons/all-files/fa/FaCommentDots";
import { FaPaperPlane } from "@react-icons/all-files/fa/FaPaperPlane";
import { FaFilter } from "@react-icons/all-files/fa/FaFilter";
import { FaSave } from "@react-icons/all-files/fa/FaSave";
import { FaTrash } from "@react-icons/all-files/fa/FaTrash";
import { getApiBase } from "../lib/apiBase";
import { ADVISING_STEPS } from "./coding-tutor/advisingFormSchema";
import useFocusTrap from "./coding-tutor/useFocusTrap";
import "./PlannerPage.css";

const API_BASE = getApiBase();
const OFFICIAL_ACADEMIC_CALENDAR_URL = "https://www.morgan.edu/academic-calendar";
const SCMNS_STUDENT_DASHBOARD_URL = "https://app.smartsheet.com/b/publish?EQBCT=23e8d37744e34f7991c2a14861e84128";
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

const formatSavedAt = (iso) => {
  if (!iso) return "an earlier session";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
};

function plannerFreshness(data) {
  const status = data?.live_schedule?.status || data?.data_source || "static";
  const asOf = data?.live_schedule?.as_of || data?.as_of;
  if (status === "live" && data?.live_schedule?.fresh !== false) {
    return {
      tone: "live",
      title: `Live seats updated ${relTime(asOf)}`,
      detail: `Cached Banner sections are within the ${data?.live_schedule?.fresh_hours || 24}-hour freshness window.`,
    };
  }
  if (status === "stale") {
    return {
      tone: "stale",
      title: `Live seats may be stale: updated ${relTime(asOf)}`,
      detail: "Planner is using the static fallback until an admin refreshes Banner sections.",
    };
  }
  return {
    tone: "static",
    title: "Static fallback: verify seats in Banner",
    detail: "No fresh live schedule cache is available for this term.",
  };
}

// Per-section availability label from the backend's `availability` + seat count.
const SEAT_LABEL = {
  open: (c) => `${c.seats_available ?? ""} seat${c.seats_available === 1 ? "" : "s"}`.trim(),
  waitlist: (c) => (
    Number.isFinite(Number(c.wait_available)) && Number(c.wait_available) > 0
      ? `Waitlist (${c.wait_available} spots)`
      : "Waitlist"
  ),
  full: (c) => (
    Number.isFinite(Number(c.seats_available))
      ? `Full (${c.seats_available} seats)`
      : "Full"
  ),
};

const DAY_LABELS = {
  M: "Mon",
  T: "Tue",
  W: "Wed",
  R: "Thu",
  F: "Fri",
  S: "Sat",
  U: "Sun",
};

function displayScheduleTime(time) {
  return String(time || "")
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const match = trimmed.match(/^([MTWRFSU]+)\s+(.+)$/);
      if (!match) return trimmed;
      const days = match[1].split("").map((day) => DAY_LABELS[day] || day).join("/");
      return `${days} ${match[2]}`;
    })
    .join(", ");
}

function advisorStatusLabel(option) {
  const count = (option?.advisor_warnings || []).length;
  if (!count) return "Ready to discuss";
  return `Review these ${count} item${count === 1 ? "" : "s"}`;
}

const PLANNER_SWAP_STORAGE_PREFIX = "planner-v2-swaps";

function plannerPlanClientId(semester, option) {
  const courseKey = (option?.courses || [])
    .map((course) => `${course.code}-${course.crn || course.section || "any"}`)
    .join("_");
  return [
    "planner",
    semester || "semester",
    option?.label || "option",
    courseKey || "courses",
  ].join("_").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 80);
}

function plannerSwapKey({ semester, timePref, maxCredits, interests, variant }) {
  const interestKey = [...(interests || [])].sort().join(",") || "none";
  return `${PLANNER_SWAP_STORAGE_PREFIX}:${semester || "auto"}:${timePref || "any"}:${maxCredits || 15}:${interestKey}:${variant || 0}`;
}

function readSavedSwaps(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function writeSavedSwaps(key, swaps) {
  try {
    const entries = Object.entries(swaps || {}).filter(([, value]) => (
      value?.code || value?.swap?.code || value?.section_crn
    ));
    if (!entries.length) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Local persistence is convenience-only; the planner should still work.
  }
}

function minutesFromTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(AM|PM)$/);
  if (!match) return 0;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (match[3] === "PM" && hour !== 12) hour += 12;
  if (match[3] === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function parseScheduleSlots(time) {
  if (!time || String(time).trim().toUpperCase() === "TBA") return [];
  return String(time).split(",").flatMap((part) => {
    const match = part.trim().match(/^([MTWRFSU]+)\s+(\d{1,2}:\d{2}(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}(?:AM|PM))$/);
    if (!match) return [];
    const [, days, start, end] = match;
    return days.split("").map((day) => [day, minutesFromTime(start), minutesFromTime(end)]);
  });
}

function courseStartMinutes(course) {
  if (course?.untimed || ["TBA", "TBD"].includes(String(course?.time || "").trim().toUpperCase())) {
    return Number.POSITIVE_INFINITY;
  }
  const slots = parseScheduleSlots(course?.time);
  if (!slots.length) return Number.POSITIVE_INFINITY;
  return Math.min(...slots.map(([, start]) => start));
}

function sortedCoursesByTime(courses = []) {
  return [...courses]
    .map((course, index) => ({ course, index }))
    .sort((a, b) => {
      const startA = courseStartMinutes(a.course);
      const startB = courseStartMinutes(b.course);
      if (startA !== startB) return startA - startB;
      const labelA = `${a.course.code || ""} ${a.course.section || ""}`;
      const labelB = `${b.course.code || ""} ${b.course.section || ""}`;
      return labelA.localeCompare(labelB) || a.index - b.index;
    })
    .map(({ course }) => course);
}

function hasScheduleConflict(slotsA = [], slotsB = []) {
  return slotsA.some(([dayA, startA, endA]) => (
    slotsB.some(([dayB, startB, endB]) => dayA === dayB && startA < endB && startB < endA)
  ));
}

function scheduleConflictFor(course, candidateTime, option) {
  const candidateSlots = parseScheduleSlots(candidateTime);
  if (!candidateSlots.length) return null;
  return (option?.courses || []).find((other) => {
    const currentCodes = new Set([course.code, course.swapped_from].filter(Boolean));
    const otherCodes = new Set([other.code, other.swapped_from].filter(Boolean));
    if ([...currentCodes].some((code) => otherCodes.has(code))) return false;
    return hasScheduleConflict(candidateSlots, parseScheduleSlots(other.time));
  }) || null;
}

function conflictsWithPlan(course, candidateTime, option) {
  return Boolean(scheduleConflictFor(course, candidateTime, option));
}

function compactRiskLabel(flag) {
  const labels = {
    verify_seats: "Verify seats",
    pick_section: "Pick section",
    tba_time: "TBA time",
    full: "Full",
    waitlist: "Waitlist",
    in_progress_prereq: "Prereq pending",
    completed_overlap: "Already completed",
    in_progress_overlap: "In progress",
    registered_overlap: "Registered",
  };
  return labels[flag?.type] || "Verify";
}

function visibleRiskFlags(course) {
  return (course.risk_flags || []).filter((flag) => {
    if (flag.type === "verify_seats") return false;
    if (flag.type === "tba_time") return false;
    if ((flag.type === "full" || flag.type === "waitlist") && course.availability === flag.type) return false;
    return true;
  });
}

function actionableRiskFlags(course) {
  return (course.risk_flags || []).filter((flag) => flag.type !== "verify_seats");
}

function requirementLabel(course) {
  return course.satisfies || course.requirement_match || "";
}

function hasCourseSpecificRisk(course) {
  return actionableRiskFlags(course).length > 0;
}

function groundedAlternatives(course) {
  return (course.alternatives || []).filter((alt) => {
    if (alt.availability === "full") return false;
    const reason = String(alt.reason || "").toLowerCase();
    return reason.includes("satisfies gened") || reason.includes("counts toward");
  });
}

function alternativeLine(alt) {
  const parts = [];
  if (alt.availability && alt.availability !== "unknown") {
    parts.push((SEAT_LABEL[alt.availability] || (() => alt.availability))(alt));
  }
  if (alt.time && alt.time !== "TBA") parts.push(displayScheduleTime(alt.time));
  if (alt.room && alt.room !== "TBA") parts.push(alt.room);
  return parts.join(" | ");
}

function usableSectionOptions(course, option) {
  return (course.section_options || []).filter((section) => (
    section.availability !== "full" && !conflictsWithPlan(course, section.time, option)
  ));
}

function hasMultipleSectionChoices(course, option) {
  return course.kind && usableSectionOptions(course, option).length > 1;
}

function alternativeConflictMessage(course, alt, option) {
  const conflict = scheduleConflictFor(course, alt.time, option);
  if (!conflict) return "";
  return `Conflicts with ${conflict.code} at ${displayScheduleTime(conflict.time)}.`;
}

function shouldShowCourseDetails(course, option) {
  return Boolean(
    groundedAlternatives(course).length ||
    hasCourseSpecificRisk(course) ||
    hasMultipleSectionChoices(course, option),
  );
}

function swapRiskFlags(alt) {
  const flags = [];
  if (alt.availability === "full") {
    flags.push({
      type: "full",
      severity: "high",
      message: "This section appears full; check Schedule Planner or Banner for an open section before relying on it.",
    });
  }
  if (alt.availability === "waitlist") {
    flags.push({
      type: "waitlist",
      severity: "warning",
      message: "This section may require a waitlist spot.",
    });
  }
  if (String(alt.time || "").toUpperCase().startsWith("TBA")) {
    flags.push({
      type: "tba_time",
      severity: "warning",
      message: "This section has a TBA time, so confirm it will not conflict.",
    });
  }
  return flags;
}

function preserveNonSectionRiskFlags(course) {
  const sectionFlagTypes = new Set(["pick_section", "full", "waitlist", "tba_time", "verify_seats"]);
  return (course.risk_flags || []).filter((flag) => !sectionFlagTypes.has(flag.type));
}

function courseFromAlternative(course, alt) {
  return {
    ...course,
    swapped_from: course.swapped_from || course.code,
    code: alt.code,
    name: alt.name,
    credits: alt.credits ?? course.credits,
    section: alt.section || "",
    instructor: alt.instructor || "",
    time: alt.time || "TBD",
    room: alt.room || "TBA",
    untimed: !alt.crn && !alt.time,
    crn: alt.crn,
    seats_available: alt.seats_available,
    wait_available: alt.wait_available,
    availability: alt.availability || "unknown",
    data_source: alt.data_source || course.data_source,
    reason: alt.reason || course.reason,
    risk_flags: swapRiskFlags(alt),
    section_options: alt.section_options || course.section_options || [],
    alternatives: [],
  };
}

function courseWithSection(course, section) {
  return {
    ...course,
    section: section.section || "",
    instructor: section.instructor || "",
    time: section.time || "TBA",
    room: section.room || "TBA",
    crn: section.crn,
    seats_available: section.seats_available,
    max_enrollment: section.max_enrollment,
    wait_count: section.wait_count,
    wait_capacity: section.wait_capacity,
    wait_available: section.wait_available,
    availability: section.availability || "unknown",
    open_section: section.open_section,
    risk_flags: [...preserveNonSectionRiskFlags(course), ...swapRiskFlags(section)],
  };
}

function reviewWarningsForCourses(courses = [], dataSource) {
  void dataSource;
  return [...new Set(courses.flatMap((course) => (
    (course.risk_flags || []).map((flag) => `${course.code}: ${flag.message}`)
  )))];
}

function verificationSummary(warnings = []) {
  const count = warnings.length;
  if (!count) return "";
  const preview = warnings.slice(0, 2).join(" ");
  const extra = count > 2 ? ` ${count - 2} more item${count - 2 === 1 ? "" : "s"} listed in course details.` : "";
  return `${preview}${extra}`;
}

function planBannerCopy(option) {
  const warnings = option?.advisor_warnings || [];
  if (warnings.length) {
    return verificationSummary(warnings);
  }
  return "";
}

function optionWithCourseSwap(option, originalCode, alt, dataSource) {
  const original = option.courses.find((course) => (
    course.code === originalCode || course.swapped_from === originalCode
  ));
  if (!original || conflictsWithPlan(original, alt.time, option)) return option;
  const courses = option.courses.map((course) => (
    course.code === originalCode || course.swapped_from === originalCode
      ? courseFromAlternative(course, alt)
      : course
  ));
  const advisorWarnings = reviewWarningsForCourses(courses, dataSource);
  return {
    ...option,
    courses,
    total_credits: courses.reduce((sum, course) => sum + Number(course.credits || 0), 0),
    advisor_status: advisorWarnings.length ? "needs_verification" : "ready",
    advisor_warnings: advisorWarnings,
  };
}

function optionWithSectionChoice(option, courseCode, crn, dataSource) {
  const courses = option.courses.map((course) => {
    if (course.code !== courseCode && course.swapped_from !== courseCode) return course;
    const section = (course.section_options || []).find((item) => String(item.crn) === String(crn));
    if (section && conflictsWithPlan(course, section.time, option)) return course;
    return section ? courseWithSection(course, section) : course;
  });
  const advisorWarnings = reviewWarningsForCourses(courses, dataSource);
  return {
    ...option,
    courses,
    advisor_status: advisorWarnings.length ? "needs_verification" : "ready",
    advisor_warnings: advisorWarnings,
  };
}

function applySavedSwapsToPlan(planData, swaps) {
  if (!planData?.options || !swaps || !Object.keys(swaps).length) return planData;
  return {
    ...planData,
    options: planData.options.map((option) => {
      const swapped = Object.entries(swaps).reduce(
        (current, [originalCode, edit]) => {
          const isLegacySwap = edit?.code && !edit?.section_crn && !edit?.swap;
          const withSwap = edit?.swap || isLegacySwap
            ? optionWithCourseSwap(current, originalCode, edit.swap || edit, planData.data_source)
            : current;
          return edit?.section_crn
            ? optionWithSectionChoice(withSwap, edit.swap?.code || edit.code || originalCode, edit.section_crn, planData.data_source)
            : withSwap;
        },
        option,
      );
      return swapped;
    }),
  };
}

function courseLine(course) {
  const bits = [
    `${course.code}${course.section ? `-${course.section}` : ""}`,
    course.name,
    `${course.credits} cr`,
  ];
  if (course.reason) bits.push(course.reason);
  if (course.time) bits.push(displayScheduleTime(course.time));
  if (course.room && course.room !== "TBA") bits.push(course.room);
  if (course.satisfies) bits.push(`satisfies ${course.satisfies}`);
  if (course.requirement_match) bits.push(`match: ${course.requirement_match}`);
  if (course.unlocks_text) bits.push(course.unlocks_text);
  if (course.availability && course.availability !== "unknown") bits.push(`seat status: ${course.availability}`);
  if (course.untimed) bits.push("pick section in WEBSIS");
  if (course.risk_flags?.length) bits.push(`verify: ${course.risk_flags.map((flag) => flag.message).join("; ")}`);
  if (groundedAlternatives(course).length) {
    bits.push(`possible swaps: ${groundedAlternatives(course).map((alt) => alt.code).join(", ")}`);
  }
  return bits.filter(Boolean).join(" | ");
}

function buildAdvisorPacket(option, data) {
  if (!option) return "";
  const calendarLink = calendarLinkForSemester(data?.semester);
  const orderedCourses = sortedCoursesByTime(option.courses);
  const courseLines = orderedCourses.map((course) => `- ${courseLine(course)}`).join("\n");
  const notes = (data?.notes || []).map((note) => `- ${note}`).join("\n");
  const unlocks = orderedCourses
    .filter((course) => course.unlocks?.length)
    .map((course) => `- ${course.code} may unlock ${course.unlocks.slice(0, 3).join(", ")}${course.unlocks.length > 3 ? "..." : ""}`)
    .join("\n");

  return [
    "Advisor Prep Packet",
    `Semester: ${prettySemester(data?.semester)}`,
    `Plan: ${option.label}`,
    `Total credits: ${option.total_credits}`,
    `Plan reason: ${option.summary_reason || "No plan explanation available."}`,
    `Tradeoff: ${option.tradeoffs || "Review workload and requirements with your advisor."}`,
    `Interest fit: ${option.interest_fit || "No selected interest fit recorded."}`,
    `Advisor status: ${advisorStatusLabel(option)}`,
    `DegreeWorks sync basis: ${data?.credits_remaining ?? "unknown"} credits remaining; ${data?.classification || "classification unknown"}`,
    "",
    "Proposed courses:",
    courseLines || "- No courses selected yet.",
    "",
    "Planner notes:",
    notes || "- No planner notes.",
    "",
    "Advisor warnings:",
    (option.advisor_warnings || []).map((warning) => `- ${warning}`).join("\n") || "- No planner warnings.",
    "",
    "Future-course impact:",
    unlocks || "- No specific unlock notes in this plan.",
    "",
    "Reminder:",
    "Submit or update Morgan State's official advising form/process, then meet with your advisor for final approval and PIN release.",
    `Official academic calendar: ${calendarLink.label} - ${calendarLink.url}`,
  ].join("\n");
}

function savedPlanPacketData(item) {
  return {
    semester: item?.semester,
    credits_remaining: item?.preferences?.credits_remaining,
    classification: item?.preferences?.classification,
    notes: item?.preferences?.notes || [],
  };
}

function buildHelperContext({ data, selectedOption, selectedInterests, savedSnapshot }) {
  const freshness = plannerFreshness(data);
  const courseRows = (selectedOption?.courses || []).map((course) => ({
    code: course.code,
    name: course.name,
    credits: course.credits,
    section: course.section || "",
    time: displayScheduleTime(course.time),
    room: course.room,
    instructor: course.instructor,
    requirement: requirementLabel(course),
    reason: course.reason,
    unlocks: course.unlocks_text || (course.unlocks || []).join(", "),
    seat_status: course.availability,
    seats_available: course.seats_available,
    warnings: (course.risk_flags || []).map((flag) => flag.message),
    alternatives: groundedAlternatives(course).map((alt) => ({
      code: alt.code,
      name: alt.name,
      status: alt.availability || "unknown",
      seats_available: alt.seats_available,
      time: displayScheduleTime(alt.time),
      room: alt.room,
      reason: alt.reason,
      tradeoff: alt.tradeoff,
    })),
  }));
  return JSON.stringify({
    plan: selectedOption ? {
      label: selectedOption.label,
      total_credits: selectedOption.total_credits,
      status: advisorStatusLabel(selectedOption),
      summary_reason: selectedOption.summary_reason,
      tradeoffs: selectedOption.tradeoffs,
      interest_fit: selectedOption.interest_fit,
      warnings: selectedOption.advisor_warnings || [],
      courses: courseRows,
    } : null,
    degreeworks: data?.degreeworks_context || {
      connected: Boolean(data?.connected),
      classification: data?.classification || "",
      credits_remaining: data?.credits_remaining ?? null,
      notes: data?.notes || [],
      registered_term: data?.registered_term || null,
    },
    planner_preferences: {
      semester: prettySemester(data?.semester),
      interests: selectedInterests,
    },
    saved_snapshot: savedSnapshot ? {
      label: savedSnapshot.option_label,
      saved_at: savedSnapshot.updated_at || savedSnapshot.created_at,
      message: "The student is viewing a saved snapshot; live seats may have changed since it was saved.",
    } : null,
    live_schedule: freshness,
  }, null, 2);
}

function PlannerReviewHelper({ selectedOption, packetText, selectedInterests = [], helperContext = "" }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const token = localStorage.getItem("token");
  const starters = [
    "Why was this plan recommended?",
    "Show me which DegreeWorks requirements this plan covers.",
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
      `Use plain text only. Do not use Markdown bold markers, headings, tables, or decorative formatting because this chat renders helper replies as plain text. ` +
      `When you list multiple courses, format only that course list as simple bullet points using "- COURSE 123 - Course Name: short reason". Do not use bullets anywhere else unless courses are being listed. ` +
      `For form-writing questions, do not append a generic advisor approval reminder; just provide the wording help. ` +
      `For schedule planning or registration questions, be concise, flag uncertainty, and remind the student to confirm final choices with their advisor and the official school process when needed.\n\n` +
      `Selected interests from Planner: ${interestText}\n` +
      `Relevant advising form fields: ${ADVISING_HELP_FIELDS.join("; ")}\n\n` +
      `Structured planner context:\n${helperContext || "No selected plan yet."}\n\n` +
      `Advisor packet text:\n${packetText || "No selected plan yet."}\n\n` +
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

function AdvisorPrep({ data, selectedOption, selectedInterests = [], savedSnapshot = null }) {
  const packetText = useMemo(() => buildAdvisorPacket(selectedOption, data), [selectedOption, data]);
  const helperContext = useMemo(
    () => buildHelperContext({ data, selectedOption, selectedInterests, savedSnapshot }),
    [data, selectedOption, selectedInterests, savedSnapshot],
  );
  const calendarLink = calendarLinkForSemester(data?.semester);
  const checklistStorageKey = `planner-advisor-checklist:${data?.semester || "default"}`;
  const [checkedItems, setCheckedItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(checklistStorageKey) || "{}");
    } catch {
      return {};
    }
  });
  const checklist = [
    { id: "degreeworks-current", label: "Confirm DegreeWorks data is connected and current" },
    { id: "pick-plan", label: "Pick the schedule option you plan to discuss" },
    { id: "review-plan", label: "Review prerequisites, repeated courses, seats, and TBA sections" },
    { id: "verify-requirements", label: "Verify in DegreeWorks that these courses satisfy the intended requirements" },
    { id: "packet", label: "Print the advisor packet from a schedule card" },
    {
      id: "internship-form",
      label: "Submit the SCMNS Internship and Work Experience Form",
      href: SCMNS_STUDENT_DASHBOARD_URL,
      note: "Sign in to the SCMNS Student Dashboard, then open Service Requests. You fill this out yourself.",
    },
    {
      id: "advising-form",
      label: "Submit or update the SCMNS Academic Advising Form",
      href: SCMNS_STUDENT_DASHBOARD_URL,
      note: "Sign in to the SCMNS Student Dashboard, then open Service Requests. You fill this out yourself.",
    },
    { id: "meet-advisor", label: "Meet with your advisor and confirm PIN/release steps" },
  ];
  useEffect(() => {
    try {
      localStorage.setItem(checklistStorageKey, JSON.stringify(checkedItems));
    } catch {
      // Checklist persistence is convenience-only.
    }
  }, [checklistStorageKey, checkedItems]);

  const toggleChecklistItem = (id) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

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
          </div>
        </div>

        <div className="pl-advisor-grid">
          <div className="pl-advisor-card">
            <h3>Checklist</h3>
            <ul className="pl-checklist">
              {checklist.map((item) => (
                <li key={item.id} className={checkedItems[item.id] ? "done" : ""}>
                  <label className="pl-check-control">
                    <input
                      type="checkbox"
                      checked={Boolean(checkedItems[item.id])}
                      onChange={() => toggleChecklistItem(item.id)}
                    />
                    <span className="pl-check-dot">{checkedItems[item.id] ? <FaCheckCircle size={13} /> : ""}</span>
                  </label>
                  <span className="pl-check-copy">
                    {item.href ? (
                      <a href={item.href} target="_blank" rel="noreferrer">
                        {item.label} <FaExternalLinkAlt size={10} />
                      </a>
                    ) : item.label}
                    {item.note && <small>{item.note}</small>}
                  </span>
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
        helperContext={helperContext}
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
  const [savedSwaps, setSavedSwaps] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [savedPlans, setSavedPlans] = useState([]);
  const [savingPlanId, setSavingPlanId] = useState("");
  const [confirmDeletePlanId, setConfirmDeletePlanId] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const deleteConfirmTimerRef = useRef(null);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const drawerRef = useFocusTrap(filtersOpen, { onEscape: closeFilters });
  // Regenerate cycles this to rotate the GenEd/minor picks (CS courses come from the
  // interests selector, not the variant). Any control change resets it to 0.
  const [variant, setVariant] = useState(0);

  const fetchPlan = useCallback((overrides = {}) => {
    const token = localStorage.getItem("token");
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError("");
    setSavedSnapshot(null);
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
        const resolvedSemester = d.semester || sem;
        const swapKey = plannerSwapKey({
          semester: resolvedSemester,
          timePref: overrides.timePref ?? timePref,
          maxCredits: overrides.maxCredits ?? maxCredits,
          interests: overrides.interests ?? interests,
          variant: nextVariant,
        });
        const persistedSwaps = readSavedSwaps(swapKey);
        setSavedSwaps(persistedSwaps);
        setData(applySavedSwapsToPlan(d, persistedSwaps));
        if (d.semester && !semester) setSemester(d.semester);
      })
      .catch((e) => setError(e.message || "Something went wrong"))
      .finally(() => setLoading(false));
  }, [semester, timePref, maxCredits, interests, variant]);

  const clearSwapsForKey = (key) => {
    writeSavedSwaps(key, {});
    setSavedSwaps({});
  };

  const regenerate = () => {
    clearSwapsForKey(plannerSwapKey({ semester: data?.semester || semester, timePref, maxCredits, interests, variant }));
    fetchPlan({ variant: variant + 1 });
  };

  const showPlannerNotice = (message) => {
    toast(message, { duration: 2600 });
  };

  useEffect(() => { fetchPlan(); /* initial */ // eslint-disable-next-line
  }, []);

  useEffect(() => () => {
    if (deleteConfirmTimerRef.current) window.clearTimeout(deleteConfirmTimerRef.current);
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
  const activeInterestLabels = useMemo(
    () => INTERESTS.filter((interest) => interests.includes(interest.key)).map((interest) => interest.label),
    [interests],
  );
  const filterSummary = [
    prettySemester(semester || data?.semester),
    TIME_PREFS.find((item) => item.key === timePref)?.label,
    `${maxCredits} credits max`,
    activeInterestLabels.length ? activeInterestLabels.join(", ") : "No interests selected",
  ].filter(Boolean).join(" | ");

  const loadSavedPlans = useCallback(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${API_BASE}/api/planning/saved-plans`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load saved plans"))))
      .then((payload) => setSavedPlans(payload.items || []))
      .catch(() => {
        // Saved plans are helpful, but a temporary API issue should not block planning.
      });
  }, []);

  useEffect(() => { loadSavedPlans(); }, [loadSavedPlans]);

  const openPrintPacket = (packetText) => {
    if (!packetText) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showPlannerNotice("Allow pop-ups to print the packet.");
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
    showPlannerNotice("Print view opened.");
  };

  const printPacket = (option) => {
    setSelectedLabel(option.label);
    openPrintPacket(buildAdvisorPacket(option, data));
  };

  const savePlan = async (option) => {
    const token = localStorage.getItem("token");
    if (!token || !option || !data?.semester) return;
    const clientId = plannerPlanClientId(data.semester, option);
    setSavingPlanId(clientId);
    const swapKey = plannerSwapKey({ semester: data.semester || semester, timePref, maxCredits, interests, variant });
    const payload = {
      client_id: clientId,
      semester: data.semester,
      option_label: option.label,
      total_credits: option.total_credits,
      plan: option,
      swaps: readSavedSwaps(swapKey),
      preferences: {
        semester: data.semester,
        time_pref: timePref,
        max_credits: maxCredits,
        interests,
        interest_labels: activeInterestLabels,
        data_source: data.data_source,
        as_of: data.as_of,
        classification: data.classification,
        credits_remaining: data.credits_remaining,
        notes: data.notes || [],
      },
      advisor_warnings: option.advisor_warnings || [],
    };
    try {
      const response = await fetch(`${API_BASE}/api/planning/saved-plans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Save failed");
      const saved = await response.json();
      setSavedPlans((prev) => [saved, ...prev.filter((item) => item.client_id !== saved.client_id)]);
      setSelectedLabel(option.label);
      showPlannerNotice(`${option.label} schedule saved!`);
    } catch {
      showPlannerNotice("Could not save this plan.");
    } finally {
      setSavingPlanId("");
    }
  };

  const restoreSavedPlan = (item) => {
    if (!item?.plan) return;
    setSavedSnapshot({
      client_id: item.client_id,
      option_label: item.option_label || item.plan.label,
      created_at: item.created_at,
      updated_at: item.updated_at,
    });
    setData((current) => {
      const base = current || {};
      const existing = base.options || [];
      const restored = { ...item.plan, label: item.option_label || item.plan.label };
      return {
        ...base,
        connected: true,
        semester: item.semester,
        options: [restored, ...existing.filter((option) => option.label !== restored.label)],
        notes: item.preferences?.notes || base.notes || [],
        data_source: item.preferences?.data_source || base.data_source || "saved",
        as_of: item.preferences?.as_of || base.as_of,
        classification: item.preferences?.classification || base.classification,
        credits_remaining: item.preferences?.credits_remaining ?? base.credits_remaining,
      };
    });
    setSemester(item.semester || semester);
    setTimePref(item.preferences?.time_pref || "any");
    setMaxCredits(Number(item.preferences?.max_credits || 15));
    setInterests(Array.isArray(item.preferences?.interests) ? item.preferences.interests : []);
    setSelectedLabel(item.option_label || item.plan.label);
    showPlannerNotice(`${item.option_label || "Saved plan"} restored.`);
  };

  const returnToGeneratedPlans = () => {
    setSavedSnapshot(null);
    fetchPlan({ variant });
    showPlannerNotice("Generated plans restored.");
  };

  const deleteSavedPlan = async (item) => {
    const token = localStorage.getItem("token");
    if (!token || !item?.client_id) return;
    if (confirmDeletePlanId !== item.client_id) {
      setConfirmDeletePlanId(item.client_id);
      if (deleteConfirmTimerRef.current) window.clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = window.setTimeout(() => setConfirmDeletePlanId(""), 4000);
      showPlannerNotice(`Tap delete again to remove ${item.option_label || "this saved plan"}.`);
      return;
    }
    if (deleteConfirmTimerRef.current) window.clearTimeout(deleteConfirmTimerRef.current);
    try {
      const response = await fetch(`${API_BASE}/api/planning/saved-plans/${encodeURIComponent(item.client_id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Delete failed");
      setSavedPlans((prev) => prev.filter((plan) => plan.client_id !== item.client_id));
      setConfirmDeletePlanId("");
      showPlannerNotice(`${item.option_label || "Saved plan"} deleted.`);
    } catch {
      showPlannerNotice("Could not delete that saved plan.");
    }
  };

  const swapCourse = (optionLabel, originalCode, alt) => {
    const clickedOption = options.find((option) => option.label === optionLabel);
    const clickedCourse = clickedOption?.courses.find((course) => (
      course.code === originalCode || course.swapped_from === originalCode
    ));
    const clickedConflict = clickedCourse && scheduleConflictFor(clickedCourse, alt.time, clickedOption);
    if (clickedConflict) {
      showPlannerNotice(`${alt.code} conflicts with ${clickedConflict.code} in this plan.`);
      return;
    }
    const swapKey = plannerSwapKey({ semester: data?.semester || semester, timePref, maxCredits, interests, variant });
    const nextSwaps = { ...readSavedSwaps(swapKey), [originalCode]: { swap: alt } };
    writeSavedSwaps(swapKey, nextSwaps);
    setSavedSwaps(nextSwaps);
    const matchingOptions = (data?.options || []).filter((option) => (
      option.courses.some((course) => course.code === originalCode || course.swapped_from === originalCode)
    ));
    const skippedConflicts = matchingOptions.flatMap((option) => {
      const course = option.courses.find((item) => item.code === originalCode || item.swapped_from === originalCode);
      const conflict = course ? scheduleConflictFor(course, alt.time, option) : null;
      return conflict ? [{ option: option.label, conflict }] : [];
    });
    const skippedCount = skippedConflicts.length;
    const swappedCount = Math.max(0, matchingOptions.length - skippedCount);
    setData((current) => {
      if (!current?.options) return current;
      return {
        ...current,
        options: current.options.map((option) => {
          const hasOriginal = option.courses.some((course) => (
            course.code === originalCode || course.swapped_from === originalCode
          ));
          if (!hasOriginal) return option;
          return optionWithCourseSwap(option, originalCode, alt, current.data_source);
        }),
      };
    });
    setSelectedLabel(optionLabel);
    if (skippedCount > 0) {
      const first = skippedConflicts[0];
      const reason = first?.conflict
        ? `${first.option} kept ${originalCode} because it conflicts with ${first.conflict.code}.`
        : `${skippedCount} option${skippedCount === 1 ? "" : "s"} kept ${originalCode} because of conflicts.`;
      showPlannerNotice(`${alt.code} swapped into ${swappedCount} plan option${swappedCount === 1 ? "" : "s"}; ${reason}`);
    } else {
      showPlannerNotice(`${alt.code} swapped into ${swappedCount || "matching"} plan option${swappedCount === 1 ? "" : "s"}.`);
    }
  };

  const chooseSection = (optionLabel, courseCode, crn) => {
    const option = options.find((item) => item.label === optionLabel);
    const course = option?.courses.find((item) => item.code === courseCode);
    const section = course?.section_options?.find((item) => String(item.crn) === String(crn));
    if (!option || !course || !section) return;
    if (conflictsWithPlan(course, section.time, option)) {
      showPlannerNotice(`${courseCode} section ${section.section} conflicts with this plan.`);
      return;
    }
    const swapKey = plannerSwapKey({ semester: data?.semester || semester, timePref, maxCredits, interests, variant });
    const originalCode = course.swapped_from || course.code;
    const storedSwaps = readSavedSwaps(swapKey);
    const existingEdit = storedSwaps[originalCode] || {};
    const edit = {
      ...existingEdit,
      code: existingEdit.code || originalCode,
      section_crn: crn,
    };
    if (course.swapped_from && !edit.swap) {
      edit.swap = course;
    }
    const nextSwaps = {
      ...storedSwaps,
      [originalCode]: edit,
    };
    writeSavedSwaps(swapKey, nextSwaps);
    setSavedSwaps(nextSwaps);
    const matchingOptions = (data?.options || []).filter((item) => (
      item.courses.some((candidate) => candidate.code === courseCode || candidate.swapped_from === courseCode)
    ));
    const skippedConflicts = matchingOptions.flatMap((item) => {
      const candidate = item.courses.find((row) => row.code === courseCode || row.swapped_from === courseCode);
      const conflict = candidate ? scheduleConflictFor(candidate, section.time, item) : null;
      return conflict ? [{ option: item.label, conflict }] : [];
    });
    const updatedCount = Math.max(0, matchingOptions.length - skippedConflicts.length);
    setData((current) => {
      if (!current?.options) return current;
      return {
        ...current,
        options: current.options.map((item) => {
          const hasCourse = item.courses.some((candidate) => (
            candidate.code === courseCode || candidate.swapped_from === courseCode
          ));
          if (!hasCourse) return item;
          return optionWithSectionChoice(item, courseCode, crn, current.data_source);
        }),
      };
    });
    setSelectedLabel(optionLabel);
    if (skippedConflicts.length) {
      const first = skippedConflicts[0];
      showPlannerNotice(`${courseCode} section updated in ${updatedCount} plan option${updatedCount === 1 ? "" : "s"}; ${first.option} kept its section because this conflicts with ${first.conflict.code}.`);
    } else {
      showPlannerNotice(`${courseCode} section updated in ${updatedCount || "matching"} plan option${updatedCount === 1 ? "" : "s"}.`);
    }
  };

  const resetSavedSwaps = () => {
    clearSwapsForKey(plannerSwapKey({ semester: data?.semester || semester, timePref, maxCredits, interests, variant }));
    fetchPlan({ variant });
    showPlannerNotice("Saved swaps cleared.");
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

      {savedSnapshot && (
        <div className="pl-snapshot-banner">
          <div>
            <strong>Viewing saved plan from {formatSavedAt(savedSnapshot.updated_at || savedSnapshot.created_at)}.</strong>
            <span>Live seats may have changed since this snapshot was saved.</span>
          </div>
          <button type="button" onClick={returnToGeneratedPlans}>
            Return to generated plans
          </button>
        </div>
      )}

      <div className="pl-planner-toolbar">
        <button
          type="button"
          className="pl-filter-open"
          onClick={() => setFiltersOpen(true)}
          aria-expanded={filtersOpen}
          aria-controls="planner-filter-drawer"
        >
          <FaFilter size={13} /> Filters
        </button>
        <span className="pl-filter-summary">{filterSummary}</span>
        <div className="pl-toolbar-actions">
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
          {Object.keys(savedSwaps).length > 0 && (
            <button
              type="button"
              className="pl-reset-swaps-link"
              onClick={resetSavedSwaps}
              disabled={loading}
              title="Clear saved swaps for this planner setup"
            >
              Reset swaps
            </button>
          )}
        </div>
      </div>

      {filtersOpen && (
        <div className="pl-filter-drawer-root">
          <button
            type="button"
            className="pl-filter-overlay"
            aria-label="Close planner filters"
            onClick={closeFilters}
          />
          <aside
            id="planner-filter-drawer"
            ref={drawerRef}
            className="pl-filter-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="planner-filter-title"
            tabIndex={-1}
          >
            <div className="pl-filter-head">
              <div>
                <strong id="planner-filter-title">Filters</strong>
                <span>Adjust the plan without crowding the cards.</span>
              </div>
              <button type="button" className="pl-filter-close" onClick={closeFilters} aria-label="Close planner filters" data-autofocus>
                x
              </button>
            </div>

            <div className="pl-filter-body">
              <div className="pl-filter-group">
                <h4>Semester</h4>
                <div className="pl-radio-list">
                  {(data?.available_semesters || []).map((s) => (
                    <label key={s} className={`pl-radio-item ${(semester || data?.semester) === s ? "on" : ""}`}>
                      <input
                        type="radio"
                        name="planner-semester"
                        value={s}
                        checked={(semester || data?.semester) === s}
                        onChange={(e) => onSemester(e.target.value)}
                      />
                      <span>{prettySemester(s)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pl-filter-group">
                <h4>Time of day</h4>
                <div className="pl-radio-list">
                  {TIME_PREFS.map((t) => (
                    <label key={t.key} className={`pl-radio-item ${timePref === t.key ? "on" : ""}`}>
                      <input
                        type="radio"
                        name="planner-time-pref"
                        value={t.key}
                        checked={timePref === t.key}
                        onChange={(e) => onTimePref(e.target.value)}
                      />
                      <span>{t.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="pl-filter-group">
                <h4>Max credits: {maxCredits}</h4>
                <input
                  className="pl-credit-slider"
                  type="range"
                  min={9}
                  max={18}
                  value={maxCredits}
                  onChange={(e) => setMaxCredits(Number(e.target.value))}
                  onMouseUp={(e) => onCredits(Number(e.target.value))}
                  onTouchEnd={(e) => onCredits(Number(e.target.value))}
                />
              </div>

              <div className="pl-filter-group">
                <h4>Interests</h4>
                <div className="pl-chips">
                  {INTERESTS.map((i) => (
                    <label key={i.key} className={`pl-check-chip ${interests.includes(i.key) ? "on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={interests.includes(i.key)}
                        onChange={() => toggleInterest(i.key)}
                      />
                      <span>{i.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="pl-filter-foot">
              <button type="button" className="pl-filter-close-action" onClick={closeFilters}>
                Show plans
              </button>
            </div>
          </aside>
        </div>
      )}

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
            <div key={opt.label} className={`pl-option-card${savedSnapshot && opt.label === selectedLabel ? " saved-snapshot" : ""}`}>
              <div className="pl-option-head">
                <h3>
                  {opt.label}
                  {savedSnapshot && opt.label === selectedLabel && (
                    <span className="pl-snapshot-chip">Saved snapshot</span>
                  )}
                </h3>
                <div className="pl-option-head-actions">
                  <button
                    type="button"
                    className="pl-card-icon-btn"
                    onClick={() => printPacket(opt)}
                    aria-label={`Print ${opt.label} advisor packet`}
                    title="Print packet"
                  >
                    <FaPrint size={12} />
                  </button>
                  <button
                    type="button"
                    className="pl-card-icon-btn"
                    onClick={() => savePlan(opt)}
                    disabled={savingPlanId === plannerPlanClientId(data?.semester, opt)}
                    aria-label={`Save ${opt.label} plan`}
                    title={savingPlanId === plannerPlanClientId(data?.semester, opt) ? "Saving plan" : "Save plan"}
                  >
                    <FaSave size={12} />
                  </button>
                  <span className="pl-credits">{opt.total_credits} cr</span>
                </div>
              </div>
              <div className={`pl-plan-explain ${opt.advisor_status === "ready" ? "ready" : "warn"}`}>
                <div>
                  <strong>{advisorStatusLabel(opt)}</strong>
                  {planBannerCopy(opt) && <p>{planBannerCopy(opt)}</p>}
                </div>
              </div>
              <div className="pl-courses">
                {sortedCoursesByTime(opt.courses).map((c) => (
                  <div
                    key={c.code + (c.section || "")}
                    className={`pl-course${c.untimed ? " untimed" : ""}${c.kind === "gened" ? " gened" : ""}${c.kind === "minor" ? " minor" : ""}`}
                  >
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
                          {requirementLabel(c) && (
                            <span className={`pl-tag ${c.kind === "minor" ? "minor" : "gened"}`}>
                              {requirementLabel(c)}
                            </span>
                          )}
                          {visibleRiskFlags(c).slice(0, 2).map((flag) => (
                            <span key={flag.type} className={`pl-tag risk ${flag.severity === "high" ? "high" : ""}`}>
                              {compactRiskLabel(flag)}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="pl-course-meta">
                          <span><FaClock size={11} /> {displayScheduleTime(c.time)}</span>
                          {c.room && c.room !== "TBA" && <span><FaMapMarkerAlt size={11} /> {c.room}</span>}
                        </div>
                        {c.instructor && <div className="pl-course-instr">{c.instructor}</div>}
                        <div className="pl-course-tags">
                          {c.availability && c.availability !== "unknown" && (
                            <span className={`pl-seat ${c.availability}`}>
                              {(SEAT_LABEL[c.availability] || (() => c.availability))(c)}
                            </span>
                          )}
                          {requirementLabel(c) && (
                            <span className={`pl-tag ${c.kind === "gened" ? "gened" : c.kind === "minor" ? "minor" : "satisfies"}`}>
                              <FaCheckCircle size={10} /> {requirementLabel(c)}
                            </span>
                          )}
                          {c.unlocks && c.unlocks.length > 0 && (
                            <span className="pl-tag unlocks">
                              <FaArrowRight size={10} /> unlocks {c.unlocks.slice(0, 2).join(", ")}
                              {c.unlocks.length > 2 ? ` +${c.unlocks.length - 2}` : ""}
                            </span>
                          )}
                          {visibleRiskFlags(c).slice(0, 2).map((flag) => (
                            <span key={flag.type} className={`pl-tag risk ${flag.severity === "high" ? "high" : ""}`}>
                              {compactRiskLabel(flag)}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                    {shouldShowCourseDetails(c, opt) && (
                      <details className="pl-course-why">
                        <summary>Details</summary>
                        {hasMultipleSectionChoices(c, opt) && (
                          <div className="pl-section-picker">
                            <strong>Choose section</strong>
                            <select
                              value={c.crn || ""}
                              onChange={(event) => chooseSection(opt.label, c.code, event.target.value)}
                            >
                              {usableSectionOptions(c, opt).map((section) => (
                                <option key={section.crn} value={section.crn}>
                                  {section.section || "Section"} | {(SEAT_LABEL[section.availability] || (() => section.availability))(section)} | {displayScheduleTime(section.time)} {section.room && section.room !== "TBA" ? `| ${section.room}` : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        {hasCourseSpecificRisk(c) && (
                          <div className="pl-course-alerts">
                            {(c.risk_flags || [])
                              .filter((flag) => flag.type !== "verify_seats")
                              .map((flag) => (
                              <span key={`${c.code}-${flag.type}`}>{flag.message}</span>
                            ))}
                          </div>
                        )}
                        {groundedAlternatives(c).length > 0 && (
                          <div className="pl-course-swaps">
                            <strong>Possible swap</strong>
                            {groundedAlternatives(c).map((alt) => {
                              const conflictMessage = alternativeConflictMessage(c, alt, opt);
                              return (
                              <div className={`pl-swap-option${conflictMessage ? " disabled" : ""}`} key={`${c.code}-${alt.code}`}>
                                <span>
                                  <strong>{alt.code} - {alt.name}</strong>
                                  {alternativeLine(alt) ? ` ${alternativeLine(alt)}` : ` ${alt.tradeoff}`}
                                  {conflictMessage && <em>{conflictMessage}</em>}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => swapCourse(opt.label, c.swapped_from || c.code, alt)}
                                  disabled={Boolean(conflictMessage)}
                                  title={conflictMessage || `Swap ${alt.code} into this requirement`}
                                >
                                  Swap in
                                </button>
                              </div>
                              );
                            })}
                          </div>
                        )}
                      </details>
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

      <section className="pl-saved-panel" aria-label="Saved plans">
        <div className="pl-saved-head">
          <div>
            <h2>Saved plans</h2>
            <p>Keep advisor-ready schedules you do not want to lose.</p>
          </div>
          <span>{savedPlans.length} saved</span>
        </div>
        {savedPlans.length === 0 ? (
          <p className="pl-saved-empty">Save a schedule card to pin it here for advising.</p>
        ) : (
          <div className="pl-saved-list">
            {savedPlans.map((item) => (
              <article className="pl-saved-item" key={item.client_id}>
                <div>
                  <strong>{item.option_label}</strong>
                  <span>
                    {prettySemester(item.semester)} | {item.total_credits} cr | {(item.plan?.courses || []).map((course) => course.code).join(", ")}
                  </span>
                </div>
                <div className="pl-saved-actions">
                  <button
                    type="button"
                    className="pl-saved-icon-btn"
                    onClick={() => restoreSavedPlan(item)}
                    aria-label={`Restore ${item.option_label || "saved plan"}`}
                    title="Restore plan"
                  >
                    <FaArrowRight size={12} />
                  </button>
                  <button
                    type="button"
                    className="pl-saved-icon-btn"
                    onClick={() => openPrintPacket(buildAdvisorPacket(item.plan, savedPlanPacketData(item)))}
                    aria-label={`Print ${item.option_label || "saved plan"}`}
                    title="Print packet"
                  >
                    <FaPrint size={12} />
                  </button>
                  <button
                    type="button"
                    className={`pl-saved-icon-btn danger${confirmDeletePlanId === item.client_id ? " confirm" : ""}`}
                    onClick={() => deleteSavedPlan(item)}
                    aria-label={`Delete ${item.option_label || "saved plan"}`}
                    title={confirmDeletePlanId === item.client_id ? "Confirm delete" : "Delete saved plan"}
                  >
                    <FaTrash size={12} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <AdvisorPrep
        data={data}
        selectedOption={selectedOption}
        selectedInterests={activeInterestLabels}
        savedSnapshot={savedSnapshot}
      />
    </div>
  );
}
