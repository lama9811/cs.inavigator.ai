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
            ),
        )
    except Exception as exc:
        print(f"[WARN] Scholarship grounding call failed, will try Tavily: {exc}")
        return None

    return _extract_json(getattr(response, "text", "") or "")


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

def build_instruction(student: dict, today: dict) -> str:
    """Julian's scholarship-agent prompt: urgency grouping, silent-skip of
    ineligible awards, exact section headers, HBCU-recruiting internship list."""
    return f"""You are the Morgan State Scholarship & Internship specialist for Computer Science students. Today is {today['formatted']} ({today['date']}), semester: {today['semester']}.

=== STUDENT DATA ===
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

2. Return ONLY a JSON object. No prose, no markdown fence, no commentary:

{{
  "items": [
    {{
      "name": "Scholarship or internship name",
      "kind": "scholarship" | "internship",
      "award": "Award amount or pay, or '(not listed)'",
      "eligibility": "Who qualifies",
      "deadline": "YYYY-MM-DD, or '(not listed)' if truly unknown",
      "url": "Direct application link, or '(not listed)'",
      "why": "One short sentence on why this fits THIS student"
    }}
  ],
  "note": "One or two sentences of context or encouragement."
}}

3. A MISSING DEADLINE IS NOT A REASON TO DROP AN OPPORTUNITY. Most pages do not
   state a date. If you cannot find a real deadline, set "deadline": "(not listed)"
   and STILL INCLUDE the item -- it will be shown under "Open". Only exclude an
   opportunity when you can see that its deadline has actually PASSED.

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
                # Six-plus items with full fields is a lot of JSON, and gemini-2.5-flash
                # spends part of its budget on internal reasoning before emitting any
                # text. At 4096 it hit MAX_TOKENS and truncated mid-object, so the JSON
                # would not parse.
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

    # OPEN has no pressing deadline, so lead with the vetted "Recommended" awards,
    # then fall back to soonest-deadline within each of those two halves.
    groups["OPEN"].sort(key=lambda i: (
        not i.get("curated"),                         # recommended at the very top
        i.get("days_remaining") is None,              # then dated before undated
        i.get("days_remaining") or 0,                 # then soonest first
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


def curated_opportunities(student: dict) -> list[dict]:
    """The curated awards a student is eligible for, in the item shape the UI uses."""
    data = _load_curated()
    out: list[dict] = []
    for entry in [*data["scholarships"], *data["internships"]]:
        if not entry.get("name") or not _eligible(entry, student):
            continue
        out.append({
            "name": entry.get("name"),
            "kind": entry.get("kind", "scholarship"),
            "award": entry.get("award") or "(not listed)",
            "pay": entry.get("pay"),
            "role": entry.get("role"),
            "term": entry.get("term"),
            "location": entry.get("location"),
            "eligibility": entry.get("eligibility") or "",
            "deadline": entry.get("deadline") or "(not listed)",
            "url": entry.get("url") or "(not listed)",
            "why": entry.get("why") or "",
            "curated": True,   # so the UI can badge it "Recommended"
        })
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

    # The curated core is always available, free, and eligibility-filtered.
    curated = curated_opportunities(student)

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

    live_items, sources, note = _live_search(student, query, today)

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


def _live_search(student: dict, query: str, today: dict) -> tuple[list[dict], list[dict], str]:
    """Run live search: Gemini grounding first (free), Tavily as fallback.

    Returns (live_items, sources, note). Always returns — an empty items list on
    total failure, so the caller still shows the curated core. Grounding is the
    default because it costs nothing; Tavily only runs if grounding is off or
    yields nothing AND a Tavily key is present.
    """
    instruction = build_instruction(student, today)

    # 1. Gemini google_search grounding — free, no key, no quota.
    if grounding_enabled():
        parsed = grounded_search(instruction, query, today)
        items = (parsed or {}).get("items") if isinstance(parsed, dict) else None
        if items:
            # Grounding embeds its own citations in the items' urls; no separate
            # source list the way Tavily returns one.
            return items, [], (parsed.get("note") or "")

    # 2. Tavily fallback — only if a key is set. Julian's fetch-then-summarize path.
    if is_configured():
        year = student.get("classification", "")
        major = student.get("major", "computer science")
        searches = [
            f"list of {major} scholarships {today['year']} {year} "
            f"application deadline award amount".strip(),
            f"computer science internships {today['year']} applications open "
            f"deadline Google STEP Microsoft Explore HBCU students",
        ][:MAX_SEARCHES]

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
                return parsed["items"], sources, (parsed.get("note") or "")
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

DEFAULT_INTERNSHIP_CHECKLIST = [
    "Tailored resume",
    "Cover letter",
    "Online assessment (if required)",
    "Portfolio / GitHub link",
    "Prepare for the technical interview",
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
    """Ask the model for the concrete requirements THIS award asks for."""
    kind = item.get("kind", "scholarship")
    return f"""You are helping a Morgan State CS student assemble everything a specific {kind} application requires.

=== THE OPPORTUNITY ===
Name: {item.get('name', '')}
Kind: {kind}
Award/Pay: {item.get('award') or item.get('pay') or '(not listed)'}
Eligibility: {item.get('eligibility') or '(not listed)'}
Role: {item.get('role') or '(n/a)'}
Deadline: {item.get('deadline') or '(not listed)'}
Why it fits: {item.get('why') or ''}

=== YOUR TASK ===
List the concrete application requirements a student must gather or complete for
THIS opportunity. Be specific to what the text above implies — "a 500-word essay
on leadership", not just "essay"; "two recommendation letters from faculty", not
just "letters". If the details are thin, fall back to the standard requirements
for this kind of {kind}.

Return ONLY a JSON object, no prose, no markdown fence:

{{
  "items": [
    "One clear, actionable requirement",
    "Another requirement"
  ]
}}

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
