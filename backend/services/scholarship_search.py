"""Scholarship & internship search.

Ported from Julian Ng's scholarship agent on the `feat/tutor-scholarship-v2-port`
branch of https://github.com/juliannng/cs-navigator (the `web_search` and
`deadline` ADK tools, plus the agent's instruction prompt). The search strategy,
urgency grouping, output contract and the HBCU-recruiting internship list are his.

What changed in the port, and why:
  * It runs as a plain backend service, not an ADK sub-agent. The unified agent's
    `_select_model` callback clears the tool list on every non-regular request, so a
    sub-agent's transfer function would be dropped; and the agent was deliberately
    collapsed from 8 agents to 1 for latency. Calling Gemini directly keeps both.
  * Nothing raises at import. Julian's `_get_client` raised when TAVILY_API_KEY was
    unset, which would take the whole app down on startup. Here a missing key is a
    normal, reportable state (`is_configured()`), so the page can say "not configured"
    instead of 500ing.
  * Results are returned as structured data, not just prose, so the UI can group them.

Needs TAVILY_API_KEY (free tier at https://app.tavily.com). Without it, search is
disabled and the endpoint reports that plainly.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python < 3.9
    ZoneInfo = None  # type: ignore


# --- configuration -----------------------------------------------------------

SCHOLARSHIP_TZ = os.getenv("SCHOLARSHIP_TZ", os.getenv("TUTOR_TZ", "America/New_York"))
MODEL = os.getenv("AGENT_MODEL", "gemini-2.5-flash")

# Institutional scholarship portal every answer points students back to.
SCHOLARSHIP_UNIVERSE = "morgan.scholarshipuniverse.com"

MAX_SEARCHES = 2          # Julian's rule: one broad, one narrow. Stop there.
MAX_RESULTS_PER_SEARCH = 8

# Live results are cached and SHARED across students for this long. Scholarship
# listings change on the order of weeks, not seconds, so a day-plus cache is safe
# and cuts Tavily calls by 10-50x — every student searching "CS scholarships"
# otherwise re-fetches (and re-pays for) the same public pages. See
# docs/plans/scholarships-v2.md, "The API cost question".
CACHE_TTL_SECONDS = int(os.getenv("SCHOLARSHIP_CACHE_TTL", str(48 * 3600)))

# Curated core of stable, high-value awards. Served with ZERO per-student API
# cost, so the common case ("show me scholarships") never touches Tavily.
_CURATED_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data_sources", "scholarships.json"
)


def is_configured() -> bool:
    """True when a Tavily key is present. Callers report this instead of crashing."""
    return bool(os.environ.get("TAVILY_API_KEY", "").strip())


# --- dates & deadlines (Julian's deadline.py) --------------------------------

def _local_tz():
    if ZoneInfo is not None:
        try:
            return ZoneInfo(SCHOLARSHIP_TZ)
        except Exception:
            pass
    return timezone.utc


def get_current_date() -> dict:
    """Today's date plus the academic semester, for the prompt's date math."""
    now = datetime.now(_local_tz())
    month = now.month
    if month <= 5:
        semester = "Spring"
    elif month <= 7:
        semester = "Summer"
    else:
        semester = "Fall"
    return {
        "date": now.strftime("%Y-%m-%d"),
        "formatted": now.strftime("%B %d, %Y"),
        "semester": f"{semester} {now.year}",
        "year": now.year,
    }


def check_deadline(deadline_date: str) -> dict:
    """Classify a YYYY-MM-DD deadline by urgency.

    Returns status EXPIRED | TODAY | URGENT (<=7d) | UPCOMING (<=30d) | OPEN,
    or INVALID when the date can't be parsed. `days_remaining` is negative for
    an expired deadline.
    """
    if not isinstance(deadline_date, str):
        return {"status": "INVALID", "message": "deadline_date must be a string"}
    try:
        deadline = datetime.strptime(deadline_date.strip(), "%Y-%m-%d").date()
    except (ValueError, AttributeError):
        return {"status": "INVALID", "message": f"Could not parse date: {deadline_date}"}

    delta = (deadline - datetime.now(_local_tz()).date()).days
    if delta < 0:
        return {"status": "EXPIRED", "days_remaining": delta}
    if delta == 0:
        return {"status": "TODAY", "days_remaining": 0}
    if delta <= 7:
        return {"status": "URGENT", "days_remaining": delta}
    if delta <= 30:
        return {"status": "UPCOMING", "days_remaining": delta}
    return {"status": "OPEN", "days_remaining": delta}


# --- query intent: scholarships vs internships -------------------------------
#
# "Summer internships for CS majors" should NOT return scholarships. We detect the
# kind the student asked for and use it to (a) filter the curated core, (b) steer
# the AI prompt, and (c) shape the Tavily searches. Keyword-based on purpose: it's
# instant, deterministic, and needs no extra AI call.

# `intern\w*` catches intern / interns / internship / internships in one branch —
# an alternation like (internship|interns?) fails on "internships" because the
# first alternative matches then the trailing \b lands mid-word.
_INTERNSHIP_WORDS = re.compile(
    r"\b(intern\w*|co-?op|apprenticeship|new\s?grad|entry[-\s]?level|swe|"
    r"work\s+experience|placement)\b",
    re.IGNORECASE,
)
_SCHOLARSHIP_WORDS = re.compile(
    r"\b(scholarship\w*|grant\w*|fellowship\w*|bursary|financial\s+aid|"
    r"tuition|award\w*|funding)\b",
    re.IGNORECASE,
)


def detect_kind_intent(query: str) -> str:
    """Infer whether the query wants 'scholarship', 'internship', or 'both'.

    Returns 'both' when the query names neither or both kinds — the safe default
    that preserves the original behavior. Only narrows to one kind when the query
    clearly asks for that kind and not the other."""
    q = query or ""
    wants_intern = bool(_INTERNSHIP_WORDS.search(q))
    wants_scholar = bool(_SCHOLARSHIP_WORDS.search(q))
    if wants_intern and not wants_scholar:
        return "internship"
    if wants_scholar and not wants_intern:
        return "scholarship"
    return "both"


# --- web search (Julian's web_search.py) -------------------------------------

def web_search(query: str, max_results: int = 5) -> dict[str, Any]:
    """Search the web for current scholarship / internship info.

    Returns {"results": [{title, url, snippet, published_date}, ...]}. On any
    failure returns the same shape with an "error" key and an empty list, so
    callers never have to catch.
    """
    max_results = max(1, min(10, int(max_results or 5)))
    api_key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not api_key:
        return {"error": "TAVILY_API_KEY is not set", "results": []}

    try:
        from tavily import TavilyClient

        # "advanced" costs more per call but returns real page content instead of
        # homepage blurbs. With "basic", snippets were landing-page taglines with no
        # award names or deadlines in them, so the model had nothing to list.
        raw = TavilyClient(api_key=api_key).search(
            query=query,
            max_results=max_results,
            search_depth="advanced",
            include_answer=False,
        )
    except Exception as exc:
        # Network error, bad key, quota, or the package missing. Degrade, don't raise.
        return {"error": str(exc), "results": []}

    return {
        "results": [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "snippet": r.get("content", ""),
                "published_date": r.get("published_date"),
            }
            for r in (raw.get("results") or [])
        ]
    }


# --- Gemini google_search grounding (the free primary path) ------------------
#
# The plan's option (c): the same google_search grounding the app already uses in
# general chat and research_agent. No API key, no vendor, no quota — so this is
# the DEFAULT live-search path, with Tavily kept only as a fallback. One grounded
# call both searches the web AND returns structured items, so there's no separate
# fetch-then-summarize step (and no second bill) like the Tavily path needs.
#
# Constraint: Gemini forbids response_mime_type="application/json" together with a
# tool, so we ask for JSON in the prompt and extract it, the way research_agent
# does. Grounding returns prose-plus-JSON, not clean structured hits.

# Enabled by default; set SCHOLARSHIP_USE_GROUNDING=false to force the Tavily path.
def grounding_enabled() -> bool:
    return os.getenv("SCHOLARSHIP_USE_GROUNDING", "true").strip().lower() != "false"


def _grounded_prompt(instruction: str, query: str, today: dict) -> str:
    return (
        f"{instruction}\n\n"
        f"=== STUDENT'S REQUEST ===\n{query}\n\n"
        f"Use Google Search to find CURRENT, real scholarships and internships that "
        f"match. Today is {today['date']}. Only include opportunities you can find "
        f"right now with a real application link. Return the JSON object now."
    )


# Gemini grounding returns citation links wrapped in a Vertex redirect host, e.g.
# https://vertexaisearch.cloud.google.com/grounding-api-redirect/<token> . Those
# work but are ugly, opaque, and can expire — a saved item should link to the real
# employer/scholarship page, not a Google redirect. We resolve them to their final
# destination once, at search time.
_GROUNDING_REDIRECT_HOST = "vertexaisearch.cloud.google.com"


def _is_grounding_redirect(url: str) -> bool:
    return isinstance(url, str) and _GROUNDING_REDIRECT_HOST in url and "grounding-api-redirect" in url


def _resolve_redirect(url: str, timeout: float = 6.0) -> str:
    """Follow a grounding redirect to its real destination; return original on failure.

    A HEAD with redirects followed is enough to learn the final URL without pulling
    the page body. Never raises — a dead or slow redirect just keeps the original,
    which still works (it simply points at the Google redirect)."""
    try:
        import httpx
        resp = httpx.head(url, follow_redirects=True, timeout=timeout)
        final = str(resp.url)
        return final if final else url
    except Exception:
        return url


def _unwrap_redirect_urls(items: list[dict]) -> list[dict]:
    """Replace grounding-redirect links in items' `url`/`source_url` with the real
    destination. Resolves each unique redirect once (cached in-call) and is bounded
    by a small per-link timeout so a few slow redirects can't stall the search."""
    if not items:
        return items
    cache: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        for field in ("url", "source_url"):
            u = item.get(field)
            if _is_grounding_redirect(u):
                if u not in cache:
                    cache[u] = _resolve_redirect(u)
                item[field] = cache[u]
    return items


def grounded_search(instruction: str, query: str, today: dict) -> Optional[dict]:
    """One grounded Gemini call: searches the web and returns the structured items.

    Returns the parsed {items, note} dict, or None on any failure so the caller
    can fall back to Tavily. Never raises.
    """
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(
            vertexai=True,
            project=os.getenv("GOOGLE_CLOUD_PROJECT", "cs-navigator-498115"),
            location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
        )
        response = client.models.generate_content(
            model=MODEL,
            contents=_grounded_prompt(instruction, query, today),
            config=types.GenerateContentConfig(
                temperature=0.1,
                # google_search cannot be combined with response_mime_type=JSON,
                # so we parse the object out of the reply instead.
                tools=[types.Tool(google_search=types.GoogleSearch())],
                # Grounding reads live search results, so it needs SOME reasoning —
                # but left unbounded, gemini-2.5-flash spent so much of its output
                # budget thinking that the JSON came back truncated or empty. Cap the
                # thinking budget and give an explicit, generous output ceiling so the
                # full item list actually fits.
                thinking_config=types.ThinkingConfig(thinking_budget=2048),
                max_output_tokens=16384,
            ),
        )
    except Exception as exc:
        print(f"[WARN] Scholarship grounding call failed, will try Tavily: {exc}")
        return None

    # A truncated reply parses as valid-looking partial data — treat it as a miss so
    # the caller falls back to Tavily / curated rather than showing half a list.
    candidates = getattr(response, "candidates", None) or []
    if candidates and str(getattr(candidates[0], "finish_reason", "")).endswith("MAX_TOKENS"):
        print("[WARN] Scholarship grounding hit the output-token cap; response truncated.")
        return None

    parsed = _extract_json(getattr(response, "text", "") or "")
    # Turn the Vertex redirect links into real destination URLs so saved items point
    # at the employer / scholarship page, not an opaque Google redirect.
    if isinstance(parsed, dict) and isinstance(parsed.get("items"), list):
        parsed["items"] = _unwrap_redirect_urls(parsed["items"])
    return parsed


# --- the student's eligibility profile ---------------------------------------

def build_student_profile(dw: Optional[dict], profile: Optional[dict]) -> dict:
    """Pull the eligibility fields out of DegreeWorks / the account profile.

    Julian's key insight: filter by what we already know so the student is never
    shown an award they can't win. Missing fields are simply absent, and the
    prompt then asks for them rather than guessing.
    """
    out: dict[str, Any] = {}
    if dw:
        # Field names mirror DegreeWorksData (backend/models.py): the GPA column is
        # `overall_gpa`, not `gpa`. Getting this wrong silently disables the whole
        # eligibility filter, so keep it aligned with the model.
        for key, src in (
            ("gpa", "overall_gpa"),
            ("major", "degree_program"),
            ("classification", "classification"),
            ("minor", "minor"),
        ):
            value = dw.get(src)
            if value not in (None, "", "N/A"):
                out[key] = value
    if profile:
        if not out.get("major") and profile.get("major"):
            out["major"] = profile["major"]
        if profile.get("name"):
            out["name"] = profile["name"]
    return out


def _profile_block(student: dict) -> str:
    if not student:
        return (
            "No DegreeWorks data is on file for this student. Ask for their GPA, "
            "major, and class year before searching."
        )
    lines = [f"- {k.replace('_', ' ').title()}: {v}" for k, v in student.items()]
    return "\n".join(lines)


# --- the prompt (Julian's instruction, adapted) -------------------------------

def _kind_directive(kind: str) -> str:
    """A hard instruction telling the model which kind(s) to return."""
    if kind == "internship":
        return (
            "=== KIND FILTER (STRICT) ===\n"
            "The student asked ONLY for INTERNSHIPS. Return internships, co-ops and "
            "apprenticeships ONLY. Do NOT include any scholarships, grants, or "
            'fellowships. Every item must have "kind": "internship".\n'
        )
    if kind == "scholarship":
        return (
            "=== KIND FILTER (STRICT) ===\n"
            "The student asked ONLY for SCHOLARSHIPS. Return scholarships, grants and "
            "fellowships ONLY. Do NOT include any internships or co-ops. Every item "
            'must have "kind": "scholarship".\n'
        )
    return ""


def build_instruction(student: dict, today: dict, kind: str = "both") -> str:
    """Julian's scholarship-agent prompt: urgency grouping, silent-skip of
    ineligible awards, exact section headers, HBCU-recruiting internship list.

    `kind` ('scholarship' | 'internship' | 'both') adds a strict filter so an
    internships search never returns scholarships and vice versa."""
    return f"""You are the Morgan State Scholarship & Internship specialist for Computer Science students. Today is {today['formatted']} ({today['date']}), semester: {today['semester']}.

{_kind_directive(kind)}=== STUDENT DATA ===
{_profile_block(student)}

Use this to AUTOMATICALLY filter results. Do NOT recommend anything the student is
ineligible for (e.g. a 3.5 GPA requirement when they have a 3.2). Skip ineligible
opportunities SILENTLY -- do not mention them or explain why they were dropped.

=== NON-NEGOTIABLE OUTPUT RULES ===

1. DEADLINE + URGENCY:
   - Compare every deadline against {today['date']}. Do the math yourself.
   - NEVER show expired opportunities. Skip them silently.
   - URGENT if under 7 days out, UPCOMING if under 30 days, OPEN otherwise.
   - Within each group, sort by soonest deadline first.
   - PREFER opportunities that publish a real, specific application deadline.
     When you must choose which results to include, favor the ones with a
     concrete date over vague "rolling" / "opens in the fall" listings. This is
     a preference, NOT a filter: still include strong undated opportunities
     (rule 3) -- just lead with the dated ones.

2. Return ONLY a JSON object. No prose, no markdown fence, no commentary:

{{
  "items": [
    {{
      "name": "Scholarship or internship name",
      "kind": "scholarship" | "internship",
      "award": "Award amount or pay, or '(not listed)'",
      "eligibility": "Who qualifies",
      "deadline": "YYYY-MM-DD, or '(not listed)' if truly unknown",
      "deadline_type": "fixed" | "rolling" | "recurring" | "unknown",
      "url": "Direct application link, or '(not listed)'",
      "why": "One short sentence on why this fits THIS student"
    }}
  ],
  "note": "One or two sentences of context or encouragement."
}}

3. A MISSING DEADLINE IS NOT A REASON TO DROP AN OPPORTUNITY. Most pages do not
   state a single date. Still INCLUDE the item -- it will be shown under "Open".
   Only exclude an opportunity when you can see that its deadline has actually
   PASSED. Classify EVERY item's "deadline_type" so the student knows what kind of
   timing it has:
   - "fixed":     there is a real calendar deadline. Put it in "deadline" (YYYY-MM-DD).
   - "rolling":   applications are accepted on an ongoing basis / "apply anytime".
                  Set "deadline": "(not listed)".
   - "recurring": it reopens on a cycle you can see (e.g. "opens every fall",
                  "applications open in winter"). Set "deadline": "(not listed)" and
                  put the cycle wording in "eligibility" or "why" if helpful.
   - "unknown":   you genuinely cannot tell. Set "deadline": "(not listed)".
   Only use a real date with "fixed". NEVER invent a date to make something "fixed".

4. AIM FOR AT LEAST SIX ITEMS. Every distinct scholarship, internship, or program
   named anywhere in the search results counts, including ones named inside a
   snippet or a listing page. Thoroughness beats brevity.

5. Never invent an award, a deadline, or a link. Never silently drop a field: if the
   amount or link is unknown, write "(not listed)" rather than omitting the key.

6. Use only opportunities that appear in the SEARCH RESULTS below. Do not add awards
   from memory. If the results genuinely name none, return an empty "items" list.

=== WHAT TO LOOK FOR ===

SCHOLARSHIPS: morgan.edu financial aid, ScholarshipUniverse, fastweb,
scholarships.com, bold.org, uncf.org, thurgoodmarshallfund.org. Filter by the
student's GPA, year and major.

INTERNSHIPS: prioritize HBCU-recruiting programs -- Google STEP, Microsoft Explore,
Meta University, Amazon Propel, Apple, IBM, NASA, NSA, Capital One, JPMorgan,
Goldman Sachs, Lockheed Martin, Northrop Grumman. Also morgan.edu/career-center
and Handshake.

In "note", remind the student to check {SCHOLARSHIP_UNIVERSE} for institutional
scholarships."""


# --- Gemini call + JSON extraction -------------------------------------------

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def _extract_json(text: str) -> Optional[dict]:
    """Pull a JSON object out of the model's reply, fence or no fence."""
    if not text:
        return None
    candidate = text.strip()

    fenced = _JSON_FENCE_RE.search(candidate)
    if fenced:
        candidate = fenced.group(1).strip()
    else:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start != -1 and end > start:
            candidate = candidate[start : end + 1]

    try:
        parsed = json.loads(candidate)
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _ask_gemini(instruction: str, search_results: list[dict], query: str) -> Optional[dict]:
    """Send the search results to Gemini and get back the structured list."""
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(
            vertexai=True,
            project=os.getenv("GOOGLE_CLOUD_PROJECT", "cs-navigator-498115"),
            location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
        )
        prompt = (
            f"{instruction}\n\n"
            f"=== STUDENT'S REQUEST ===\n{query}\n\n"
            f"=== SEARCH RESULTS ===\n{json.dumps(search_results, indent=2)}\n\n"
            "Return the JSON object now."
        )
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.1,           # near-deterministic; these are facts, not prose
                # gemini-2.5-flash is a THINKING model: it spends output tokens on
                # internal reasoning before emitting any text, and that counts against
                # max_output_tokens. On a big result list it burned the whole budget
                # reasoning and hit MAX_TOKENS with the JSON truncated mid-object. This
                # is pure extraction, not a reasoning task, so turn thinking OFF and give
                # the full budget to the answer.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                max_output_tokens=16384,
                # Ask for JSON directly instead of hoping the prompt is obeyed. This
                # also stops the model wrapping the object in a ```json fence.
                response_mime_type="application/json",
            ),
        )
    except Exception as exc:
        print(f"[ERROR] Scholarship Gemini call failed: {exc}")
        return None

    # A truncated reply is worse than none: it parses as valid-looking partial data.
    # Surface it as a failure so the caller falls back to showing the raw sources.
    candidates = getattr(response, "candidates", None) or []
    if candidates and str(getattr(candidates[0], "finish_reason", "")).endswith("MAX_TOKENS"):
        print("[WARN] Scholarship summary hit the output-token cap; response truncated.")
        return None

    return _extract_json(getattr(response, "text", "") or "")


# --- urgency grouping (the shape the UI renders) ------------------------------

# How to describe an item's timing when there is no single calendar date. The
# model classifies each item; we normalize it so the UI can show "Rolling — apply
# anytime" or "Reopens on a cycle" instead of a bare "(not listed)".
VALID_DEADLINE_TYPES = ("fixed", "rolling", "recurring", "unknown")


def normalize_deadline_type(item: dict) -> str:
    """Return a valid deadline_type for an item, inferring one when it's missing.

    Trusts the model's value when it's one we recognize. Otherwise infers: a
    parseable real date is "fixed"; anything else defaults to "unknown". This runs
    on every item so downstream code (and the UI) can always rely on the field.
    """
    raw = str(item.get("deadline_type") or "").strip().lower()
    if raw in VALID_DEADLINE_TYPES:
        return raw
    # No usable hint from the model — infer from the deadline itself.
    if check_deadline(str(item.get("deadline", ""))).get("status") not in ("INVALID", None):
        return "fixed"
    return "unknown"


# Ordering preference among UNDATED items: a knowable cadence beats "no idea".
# Lower sorts first. (Dated "fixed" items never reach this — they sort by date.)
_TIMING_RANK = {"fixed": 0, "rolling": 1, "recurring": 2, "unknown": 3}


def _timing_rank(deadline_type: Optional[str]) -> int:
    return _TIMING_RANK.get(str(deadline_type or "unknown").lower(), 3)


def _group_by_urgency(items: list[dict]) -> dict[str, list[dict]]:
    """Sort items into URGENT / UPCOMING / OPEN, dropping anything expired.

    The model is told to do this, but we enforce it in code too: an expired award
    shown to a student is worse than one omitted, and we can't trust date math to
    a language model.
    """
    groups: dict[str, list[dict]] = {"URGENT": [], "UPCOMING": [], "OPEN": []}

    for item in items:
        if not isinstance(item, dict) or not item.get("name"):
            continue

        # Always stamp a normalized deadline_type so the UI never sees a raw blank.
        item["deadline_type"] = normalize_deadline_type(item)

        verdict = check_deadline(str(item.get("deadline", "")))
        status = verdict.get("status")

        if status == "EXPIRED":
            continue  # never show a dead deadline
        if status == "TODAY":
            status = "URGENT"
        if status in ("INVALID", None):
            # No parseable deadline (rolling, or "(not listed)"). Still useful.
            status = "OPEN"
            item["days_remaining"] = None
        else:
            item["days_remaining"] = verdict.get("days_remaining")

        groups[status].append(item)

    # URGENT / UPCOMING are time-critical, so they sort purely by deadline —
    # a closing-soon award outranks everything, curated or not.
    for status in ("URGENT", "UPCOMING"):
        groups[status].sort(key=lambda i: (
            i.get("days_remaining") is None,          # dated before undated
            i.get("days_remaining") or 0,             # soonest first
            not i.get("curated"),                     # tie-break: recommended first
        ))

    # OPEN ordering PREFERS opportunities with a real date (they're the most
    # actionable), without hiding the undated ones. Order:
    #   1. dated items first (has a real deadline the student can plan around),
    #   2. among dated: recommended, then soonest deadline,
    #   3. among undated: recommended, then by timing quality
    #      (rolling/recurring — a knowable cadence — above "unknown").
    groups["OPEN"].sort(key=lambda i: (
        i.get("days_remaining") is None,              # dated (False) sorts before undated (True)
        not i.get("curated"),                         # recommended first within each half
        i.get("days_remaining") or 0,                 # dated: soonest first
        _timing_rank(i.get("deadline_type")),         # undated: rolling/recurring before unknown
    ))
    return groups


# --- the one entry point the endpoint calls ----------------------------------

# --- curated core database ---------------------------------------------------
# The zero-cost layer: ~50-100 stable, high-value awards served from a JSON file,
# eligibility-filtered per student. Live search augments this for the long tail.

_curated_cache: Optional[dict] = None


def _load_curated() -> dict:
    """Load and cache the curated award file. Missing/corrupt file -> empty, never raises."""
    global _curated_cache
    if _curated_cache is not None:
        return _curated_cache
    try:
        with open(_CURATED_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        _curated_cache = {
            "scholarships": data.get("scholarships") or [],
            "internships": data.get("internships") or [],
        }
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"[WARN] Could not load curated scholarships: {exc}")
        _curated_cache = {"scholarships": [], "internships": []}
    return _curated_cache


def _eligible(entry: dict, student: dict) -> bool:
    """Keep an award unless the student's GPA is below its stated minimum.

    Conservative on purpose: only a KNOWN gpa below a KNOWN minimum excludes an
    award. Missing either side keeps it — better to show one the student might not
    win than to hide one they would.
    """
    min_gpa = entry.get("eligibility_min_gpa")
    if min_gpa is None:
        return True
    try:
        student_gpa = float(student.get("gpa"))
    except (TypeError, ValueError):
        return True  # unknown GPA: don't filter it out
    return student_gpa >= float(min_gpa)


def curated_opportunities(student: dict, kind: str = "both") -> list[dict]:
    """The curated awards a student is eligible for, in the item shape the UI uses.

    `kind` filters the pool: 'scholarship' or 'internship' returns only that kind,
    'both' (default) returns everything. This is how an "internships" search stops
    pulling in curated scholarships."""
    data = _load_curated()
    if kind == "scholarship":
        pool = list(data["scholarships"])
    elif kind == "internship":
        pool = list(data["internships"])
    else:
        pool = [*data["scholarships"], *data["internships"]]
    out: list[dict] = []
    for entry in pool:
        if not entry.get("name") or not _eligible(entry, student):
            continue
        item = {
            "name": entry.get("name"),
            "kind": entry.get("kind", "scholarship"),
            "award": entry.get("award") or "(not listed)",
            "pay": entry.get("pay"),
            "role": entry.get("role"),
            "term": entry.get("term"),
            "location": entry.get("location"),
            "eligibility": entry.get("eligibility") or "",
            "deadline": entry.get("deadline") or "(not listed)",
            "deadline_type": entry.get("deadline_type"),  # normalized just below
            "url": entry.get("url") or "(not listed)",
            "why": entry.get("why") or "",
            "curated": True,   # so the UI can badge it "Recommended"
        }
        item["deadline_type"] = normalize_deadline_type(item)
        out.append(item)
    return out


# --- shared result cache -----------------------------------------------------
# A process-level cache shared across students. Keyed on the normalized query so
# two students asking the same thing hit one Tavily bill, not two.

_result_cache: dict[str, tuple[float, dict]] = {}


def _cache_key(query: str, student: dict) -> str:
    """Cache on the query + the fields that change results (major, year, gpa band).

    GPA is bucketed so near-identical students share a cache entry instead of each
    minting their own; the per-student eligibility filter runs after retrieval
    anyway, so the shared cache is safe.
    """
    try:
        gpa_band = int(float(student.get("gpa")) * 2) / 2  # nearest 0.5
    except (TypeError, ValueError):
        gpa_band = "na"
    major = (student.get("major") or "").strip().lower()
    year = (student.get("classification") or "").strip().lower()
    return f"{(query or '').strip().lower()}|{major}|{year}|{gpa_band}"


def _cache_get(key: str, now: float) -> Optional[dict]:
    hit = _result_cache.get(key)
    if not hit:
        return None
    stored_at, value = hit
    if now - stored_at > CACHE_TTL_SECONDS:
        _result_cache.pop(key, None)   # expired
        return None
    return value


def _cache_put(key: str, value: dict, now: float) -> None:
    _result_cache[key] = (now, value)


def clear_cache() -> None:
    """Drop all cached results. For tests and admin refresh."""
    _result_cache.clear()


def find_opportunities(query: str, student: dict, now: Optional[float] = None) -> dict:
    """Search, filter by eligibility, and group by deadline urgency.

    Returns {"configured", "groups", "note", "total", "sources"}. Never raises --
    every failure path returns a dict the UI can render.

    The curated core is always included and served free. Live web search augments
    it when TAVILY_API_KEY is set, and live results are cached and shared across
    students for CACHE_TTL_SECONDS so the department doesn't re-pay per search.
    `now` is injectable for tests; defaults to wall-clock.
    """
    import time
    now = time.time() if now is None else now

    today = get_current_date()
    query = (query or "").strip() or "scholarships and internships for me"

    # What kind did the student ask for? Used to filter curated, steer the prompt,
    # and shape the Tavily searches so "internships" doesn't return scholarships.
    kind = detect_kind_intent(query)

    # The curated core is always available, free, and eligibility-filtered — but
    # only the kind the student asked for.
    curated = curated_opportunities(student, kind)

    # Live search is available if EITHER grounding is on (free, no key) or Tavily
    # is configured. Only when neither is usable do we show curated alone.
    live_available = grounding_enabled() or is_configured()
    if not live_available:
        groups = _group_by_urgency(curated)
        return {
            "configured": False,
            "groups": groups,
            "note": "Showing our curated list of top scholarships and internships. "
                    "Live web search is turned off right now — but these are the "
                    "awards worth applying to.",
            "total": sum(len(v) for v in groups.values()),
            "sources": [],
        }

    # Serve a cached shared result if we have a fresh one (shared across students).
    key = _cache_key(query, student)
    cached = _cache_get(key, now)
    if cached is not None:
        merged = _merge_and_group(curated, cached.get("live_items") or [])
        return {
            "configured": True,
            "groups": merged,
            "note": cached.get("note", ""),
            "total": sum(len(v) for v in merged.values()),
            "sources": cached.get("sources", []),
            "cached": True,
        }

    live_items, sources, note = _live_search(student, query, today, kind)

    # Cache the LIVE half (shared across students); curated is merged in per-call
    # so its eligibility filter always reflects the current student.
    _cache_put(key, {"live_items": live_items, "note": note, "sources": sources}, now)

    merged = _merge_and_group(curated, live_items)
    fallback_note = (
        note or "Showing our curated list; live search added nothing new this time."
    )
    return {
        "configured": True,
        "groups": merged,
        "note": fallback_note,
        "total": sum(len(v) for v in merged.values()),
        "sources": sources,
        "cached": False,
    }


def _filter_items_by_kind(items: list[dict], kind: str) -> list[dict]:
    """Drop items that don't match the requested kind. 'both' keeps everything.

    Belt-and-suspenders: even with a kind-steered prompt the model can slip in an
    off-kind result, so we enforce it in code before the student ever sees it."""
    if kind == "both":
        return items
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        if str(it.get("kind") or "scholarship").strip().lower() == kind:
            out.append(it)
    return out


def _live_search(
    student: dict, query: str, today: dict, kind: str = "both"
) -> tuple[list[dict], list[dict], str]:
    """Run live search: Gemini grounding first (free), Tavily as fallback.

    Returns (live_items, sources, note). Always returns — an empty items list on
    total failure, so the caller still shows the curated core. Grounding is the
    default because it costs nothing; Tavily only runs if grounding is off or
    yields nothing AND a Tavily key is present. `kind` narrows results to the kind
    the student asked for (scholarship / internship), else 'both'.
    """
    instruction = build_instruction(student, today, kind)

    # 1. Gemini google_search grounding — free, no key, no quota.
    if grounding_enabled():
        parsed = grounded_search(instruction, query, today)
        items = (parsed or {}).get("items") if isinstance(parsed, dict) else None
        if items:
            # Grounding embeds its own citations in the items' urls; no separate
            # source list the way Tavily returns one.
            return _filter_items_by_kind(items, kind), [], (parsed.get("note") or "")

    # 2. Tavily fallback — only if a key is set. Julian's fetch-then-summarize path.
    if is_configured():
        year = student.get("classification", "")
        major = student.get("major", "computer science")
        scholarship_q = (
            f"list of {major} scholarships {today['year']} {year} "
            f"application deadline award amount".strip()
        )
        internship_q = (
            f"computer science internships {today['year']} applications open "
            f"deadline Google STEP Microsoft Explore HBCU students"
        )
        # Only search for what the student asked for; 'both' runs both queries.
        if kind == "scholarship":
            searches = [scholarship_q]
        elif kind == "internship":
            searches = [internship_q]
        else:
            searches = [scholarship_q, internship_q]
        searches = searches[:MAX_SEARCHES]

        results: list[dict] = []
        seen_urls: set[str] = set()
        for search_query in searches:
            found = web_search(search_query, max_results=MAX_RESULTS_PER_SEARCH)
            if found.get("error"):
                continue
            for row in found["results"]:
                url = row.get("url", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    results.append(row)

        if results:
            parsed = _ask_gemini(instruction, results, query)
            sources = [{"title": r["title"], "url": r["url"]} for r in results[:8]]
            if parsed and parsed.get("items"):
                return _filter_items_by_kind(parsed["items"], kind), sources, (parsed.get("note") or "")
            # Summarize failed but we still have raw links to show.
            return [], sources, ""

    # Nothing worked — curated core carries the page.
    return [], [], ""


def _merge_and_group(curated: list[dict], live: list[dict]) -> dict[str, list[dict]]:
    """Combine curated and live items, dedupe, and bucket by urgency.

    Curated comes first so a hand-vetted award wins over a live duplicate of the
    same thing. Dedupe is by normalized name — a curated 'Google STEP' and a live
    'Google STEP Internship' shouldn't both show.
    """
    combined: list[dict] = []
    seen: set[str] = set()
    for item in [*curated, *live]:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        key = str(item["name"]).strip().lower()
        # Loose dedupe: collapse names where one contains the other.
        dup = any(key in s or s in key for s in seen)
        if dup:
            continue
        seen.add(key)
        combined.append(item)
    return _group_by_urgency(combined)


# --- saved opportunities (My Scholarships) -----------------------------------
#
# Search is ephemeral; a saved list is not. These helpers back the save/track
# feature: a stable dedupe key so the same award can't be saved twice, and an
# urgency recompute so "3 days left" is right on the day the student opens the
# page, not the day they saved it.

VALID_KINDS = ("scholarship", "internship")
VALID_STATUSES = (
    "interested", "applying", "submitted", "awarded", "rejected", "expired",
)


def client_key_for(name: str, url: str) -> str:
    """A stable dedupe key for a saved item.

    Keyed on name + apply URL so the SAME award re-saved from a later search
    updates the existing row instead of piling up duplicates. Case- and
    whitespace-insensitive on the name; the URL anchors it when two awards share
    a name. Short hash — collisions across a single student's saved list are
    astronomically unlikely and would only merge two genuinely identical saves.
    """
    basis = f"{(name or '').strip().lower()}|{(url or '').strip().lower()}"
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()[:32]


def recompute_urgency(deadline: Optional[str]) -> dict:
    """Re-derive a saved item's urgency from today's date.

    A row saved three weeks ago that read "UPCOMING" may now be "URGENT" or
    "EXPIRED". Callers recompute on load so the badge is never stale. Returns
    {status, days_remaining}; status is URGENT / UPCOMING / OPEN / EXPIRED, and
    an unparseable or missing deadline is OPEN with days_remaining None.
    """
    verdict = check_deadline(str(deadline or ""))
    status = verdict.get("status")
    if status == "EXPIRED":
        return {"status": "EXPIRED", "days_remaining": verdict.get("days_remaining")}
    if status == "TODAY":
        return {"status": "URGENT", "days_remaining": 0}
    if status in ("INVALID", None):
        return {"status": "OPEN", "days_remaining": None}
    return {"status": status, "days_remaining": verdict.get("days_remaining")}


# --- application checklists --------------------------------------------------
#
# The strongest idea in the plan: students don't fail to *find* scholarships, they
# find one and lose track of the six things it required. The checklist is the
# antidote. It's generated from the award's OWN requirements — a generic "essay,
# transcript, letters" list is useless; "a 500-word essay on leadership" is not —
# then the student edits it as they work.

# Fallback when there's no AI or the award lists nothing specific. Deliberately
# the common real-world set, so an empty result is still useful.
DEFAULT_SCHOLARSHIP_CHECKLIST = [
    "Personal essay / statement",
    "Official transcript",
    "Two recommendation letters",
    "FAFSA on file",
    "Current resume",
    "Proof of enrollment",
]

# An internship is a pipeline, not a single submission: apply -> online
# assessment -> interviews -> offer. The template is ordered to follow that
# pipeline, and each step is prefixed with its stage so a flat checklist still
# reads like the hiring funnel — no special data shape needed.
DEFAULT_INTERNSHIP_CHECKLIST = [
    "Apply · Tailor your resume to the role",
    "Apply · Write a short cover letter / intro",
    "Apply · Add your portfolio / GitHub link",
    "Online assessment · Complete the OA if one is sent",
    "Interview · Prepare behavioral answers (STAR stories)",
    "Interview · Prepare for the technical / coding screen",
    "Offer · Review the offer and note the deadline to accept",
]


def _checklist_items(labels: list[str]) -> list[dict]:
    """Wrap plain labels into the stored item shape: id, label, done, note.

    ids are positional strings ("item-0", ...). They only need to be unique
    within one checklist so the frontend can key rows and target toggles; a
    saved item's checklist is small and rewritten wholesale on edit, so a
    positional id is enough and keeps the payload readable.
    """
    out: list[dict] = []
    for i, label in enumerate(labels):
        text = str(label or "").strip()
        if text:
            out.append({"id": f"item-{i}", "label": text[:200], "done": False, "note": ""})
    return out


def default_checklist(kind: str) -> list[dict]:
    """The template checklist for a kind, used when AI generation isn't available."""
    labels = (
        DEFAULT_INTERNSHIP_CHECKLIST if kind == "internship"
        else DEFAULT_SCHOLARSHIP_CHECKLIST
    )
    return _checklist_items(labels)


def _checklist_prompt(item: dict) -> str:
    """Ask the model for the concrete requirements THIS opportunity asks for.

    Scholarships and internships get different task instructions: a scholarship
    is one submission (essay, transcript, letters), while an internship is a
    pipeline (apply -> online assessment -> interviews -> offer). The internship
    prompt asks for stage-prefixed steps so the flat checklist reads like the
    hiring funnel, matching DEFAULT_INTERNSHIP_CHECKLIST.
    """
    kind = item.get("kind", "scholarship")
    header = f"""You are helping a Morgan State CS student assemble everything a specific {kind} requires.

=== THE OPPORTUNITY ===
Name: {item.get('name', '')}
Kind: {kind}
Award/Pay: {item.get('award') or item.get('pay') or '(not listed)'}
Eligibility: {item.get('eligibility') or '(not listed)'}
Role: {item.get('role') or '(n/a)'}
Deadline: {item.get('deadline') or '(not listed)'}
Why it fits: {item.get('why') or ''}"""

    json_shape = """Return ONLY a JSON object, no prose, no markdown fence:

{
  "items": [
    "One clear, actionable requirement",
    "Another requirement"
  ]
}"""

    if kind == "internship":
        return f"""{header}

=== YOUR TASK ===
An internship is a pipeline, not a single submission. List the concrete steps a
student must complete across the whole hiring process for THIS internship, in
order, and PREFIX each step with its stage:
  "Apply · ..."             (resume, cover letter, portfolio, the application itself)
  "Online assessment · ..." (a coding/aptitude OA, only if one is likely)
  "Interview · ..."         (behavioral prep, technical/coding screen prep)
  "Offer · ..."             (review the offer, deadline to accept)

Be specific to what the text above implies — "Interview · Prepare for a system
design round" if it's a senior role, not just "prep". If the details are thin,
fall back to the standard software-internship pipeline.

{json_shape}

Rules:
- 5 to 8 items, ordered by stage (Apply first, Offer last).
- Every item starts with a stage prefix followed by " · ".
- Each item is one action the student can check off ("done / not done").
- Never invent a stage the text contradicts. When unsure, use the standard pipeline.
- Return only the JSON object."""

    return f"""{header}

=== YOUR TASK ===
List the concrete application requirements a student must gather or complete for
THIS scholarship. Be specific to what the text above implies — "a 500-word essay
on leadership", not just "essay"; "two recommendation letters from faculty", not
just "letters". If the details are thin, fall back to the standard requirements
for a scholarship.

{json_shape}

Rules:
- 4 to 8 items. Each is one thing the student can check off.
- Each item is an action or artifact, phrased so "done / not done" is meaningful.
- Never invent a requirement the text contradicts. When unsure, use the standard set.
- Return only the JSON object."""


def generate_checklist(item: dict) -> list[dict]:
    """Generate an application checklist for a saved opportunity.

    Reads the award's own requirements via the AI and returns stored-shape items.
    Degrades to the kind's default template on any failure — the student always
    gets a usable checklist, never an error. Never raises.
    """
    kind = item.get("kind", "scholarship")

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(
            vertexai=True,
            project=os.getenv("GOOGLE_CLOUD_PROJECT", "cs-navigator-498115"),
            location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
        )
        response = client.models.generate_content(
            model=MODEL,
            contents=_checklist_prompt(item),
            config=types.GenerateContentConfig(
                temperature=0.2,
                # Same thinking-model trap as _ask_gemini: reasoning tokens eat the
                # output budget and truncate the list, silently dropping us to the
                # default template. This is extraction, not reasoning — turn it off.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                max_output_tokens=2048,
                response_mime_type="application/json",
            ),
        )
    except Exception as exc:
        print(f"[WARN] Checklist generation failed, using default: {exc}")
        return default_checklist(kind)

    parsed = _extract_json(getattr(response, "text", "") or "")
    labels = (parsed or {}).get("items") if isinstance(parsed, dict) else None
    if not labels or not isinstance(labels, list):
        return default_checklist(kind)

    items = _checklist_items([str(x) for x in labels][:8])
    return items or default_checklist(kind)


def checklist_progress(checklist: Optional[list]) -> dict:
    """Count done/total for a checklist, tolerant of junk. {done, total}."""
    if not isinstance(checklist, list):
        return {"done": 0, "total": 0}
    total = 0
    done = 0
    for it in checklist:
        if isinstance(it, dict) and it.get("label"):
            total += 1
            if it.get("done"):
                done += 1
    return {"done": done, "total": total}


# --- dashboard rollup --------------------------------------------------------
#
# The plan's §2 ask: "Progress per application, and a dashboard rollup across all
# of them." One glance should answer: how many am I tracking, how many are due
# soon, and what's the very next deadline. Pure so it's testable without a DB;
# it takes the same serialized dicts _saved_to_dict produces.

# The "in progress" pipeline — statuses where the student still has work to do.
_ACTIVE_STATUSES = ("interested", "applying", "submitted")


def build_saved_summary(saved_items: list) -> dict:
    """Roll up a student's saved opportunities for the dashboard.

    Returns:
        {
          "total": int,                       # everything saved
          "active": int,                      # not yet decided (interested/applying/submitted)
          "by_status": {status: count, ...},  # all six statuses, zero-filled
          "by_kind": {"scholarship": int, "internship": int},
          "urgent": int,                       # active items due within 7 days
          "expiring_soon": int,                # active items due within 30 days
          "expired_active": int,               # active items whose deadline already passed
          "checklist": {"done": int, "total": int},  # summed across active items
          "next_deadlines": [ {id, name, kind, deadline, days_remaining}, ... up to 3 ],
        }
    Deliberately ignores awarded / rejected / expired items for the "what needs
    attention" numbers — those are done. by_status still counts them so the
    student sees the full picture.
    """
    by_status = {s: 0 for s in VALID_STATUSES}
    by_kind = {k: 0 for k in VALID_KINDS}
    urgent = expiring_soon = expired_active = 0
    done_sum = total_sum = 0
    upcoming: list[dict] = []

    for item in saved_items:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "interested").strip().lower()
        if status in by_status:
            by_status[status] += 1
        kind = str(item.get("kind") or "scholarship").strip().lower()
        if kind in by_kind:
            by_kind[kind] += 1

        if status not in _ACTIVE_STATUSES:
            continue  # awarded/rejected/expired don't count toward "needs attention"

        prog = checklist_progress(item.get("checklist"))
        done_sum += prog["done"]
        total_sum += prog["total"]

        verdict = check_deadline(str(item.get("deadline") or ""))
        days = verdict.get("days_remaining")
        if not isinstance(days, int):
            continue
        if days < 0:
            expired_active += 1
            continue
        if days <= 7:
            urgent += 1
        if days <= 30:
            expiring_soon += 1
        upcoming.append({
            "id": item.get("id"),
            "name": item.get("name"),
            "kind": kind,
            "deadline": item.get("deadline"),
            "days_remaining": days,
        })

    upcoming.sort(key=lambda i: i["days_remaining"])
    active = sum(by_status[s] for s in _ACTIVE_STATUSES)

    return {
        "total": sum(by_status.values()),
        "active": active,
        "by_status": by_status,
        "by_kind": by_kind,
        "urgent": urgent,
        "expiring_soon": expiring_soon,
        "expired_active": expired_active,
        "checklist": {"done": done_sum, "total": total_sum},
        "next_deadlines": upcoming[:3],
    }


# --- deadline nudges ---------------------------------------------------------
#
# The plan's §2 ask: "deadline-aware nudges — reuse the existing reminder engine
# rather than building a new one." The Canvas engine (services/reminder_engine.py)
# is assignment-shaped (course_id / submission states), so it can't be called
# directly here. This is the scholarship-shaped twin: a pure selector, tested
# without a DB, with the SentReminder ledger and email send living in main.py —
# exactly the same split as reminder_engine + internal_reminders_dispatch.

# Statuses that mean "don't nudge": the student is done with this one either way.
_TERMINAL_STATUSES = {"submitted", "awarded", "rejected", "expired"}

# Default lead time. Scholarships are multi-day work, so we warn earlier than the
# 24h Canvas window — a week gives a student time to actually gather documents.
DEFAULT_REMINDER_LEAD_DAYS = int(os.getenv("SCHOLARSHIP_REMINDER_LEAD_DAYS", "7"))


def scholarship_reminder_key(saved_id, deadline: Optional[str]) -> str:
    """Stable per-saved-item dedup key.

    Prefixed 'sch:' so it shares the SentReminder ledger with Canvas assignment
    keys without ever colliding. The deadline is part of the key on purpose: if
    the student edits the saved deadline, the key changes and one fresh nudge is
    sent for the new date (same trick reminder_key uses for moved assignments)."""
    return f"sch:{saved_id}:{(deadline or '').strip()}"


def select_due_scholarship_reminders(
    saved_items,
    sent_keys,
    now: Optional[datetime] = None,
    lead_days: int = DEFAULT_REMINDER_LEAD_DAYS,
):
    """Pick saved scholarships whose deadline is close enough to nudge now.

    A saved item qualifies when ALL hold:
      - it has a parseable future deadline within `lead_days` (0 < days <= lead),
      - its status is not terminal (submitted / awarded / rejected / expired),
      - no nudge has been sent for it yet (key not in `sent_keys`).

    Deliberately pure — plain dicts in, plain dicts out — so it is unit-testable
    without a DB or the network. The DB-aware wrapper lives in main.py.

    Args:
        saved_items: list of dicts, each at least {id, deadline, status, name, ...}.
        sent_keys: set of already-sent reminder keys.
        now: timezone-aware UTC "current time" (defaults to real now).
        lead_days: warn this many days before the deadline (default 7).

    Returns:
        list of {"item": <dict>, "key": <str>, "days_remaining": <int>} for
        qualifying items, soonest deadline first.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    sent = set(sent_keys)

    selected = []
    for item in saved_items:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "").strip().lower()
        if status in _TERMINAL_STATUSES:
            continue
        verdict = check_deadline(str(item.get("deadline") or ""))
        days = verdict.get("days_remaining")
        # Skip missing/invalid/expired deadlines and anything outside the window.
        if not isinstance(days, int) or not (0 < days <= lead_days):
            continue
        key = scholarship_reminder_key(item.get("id"), item.get("deadline"))
        if key in sent:
            continue
        selected.append({"item": item, "key": key, "days_remaining": days})

    selected.sort(key=lambda r: r["days_remaining"])
    return selected
