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
            project=os.getenv("GOOGLE_CLOUD_PROJECT", "csnavigator-vertex-ai"),
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

    # Soonest first inside each group; undated entries sink to the bottom.
    for bucket in groups.values():
        bucket.sort(key=lambda i: (i.get("days_remaining") is None,
                                   i.get("days_remaining") or 0))
    return groups


# --- the one entry point the endpoint calls ----------------------------------

def find_opportunities(query: str, student: dict) -> dict:
    """Search, filter by eligibility, and group by deadline urgency.

    Returns {"configured", "groups", "note", "total", "sources"}. Never raises --
    every failure path returns a dict the UI can render.
    """
    if not is_configured():
        return {
            "configured": False,
            "groups": {"URGENT": [], "UPCOMING": [], "OPEN": []},
            "note": "Scholarship search is not configured yet. Ask an admin to set "
                    "TAVILY_API_KEY.",
            "total": 0,
            "sources": [],
        }

    today = get_current_date()
    query = (query or "").strip() or "scholarships and internships for me"

    # Julian's strategy: one broad query, one narrow follow-up. Two searches, no more.
    #
    # The queries deliberately ask for *lists of named awards* ("list of ... with
    # deadlines / amounts"), not for institutions. Searching "Morgan State
    # scholarships" returns the university's landing page, whose snippet names no
    # actual award, so the model has nothing concrete to report.
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
    errors: list[str] = []

    for search_query in searches:
        found = web_search(search_query, max_results=MAX_RESULTS_PER_SEARCH)
        if found.get("error"):
            errors.append(found["error"])
            continue
        for row in found["results"]:
            url = row.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                results.append(row)

    if not results:
        detail = errors[0] if errors else "no results"
        return {
            "configured": True,
            "groups": {"URGENT": [], "UPCOMING": [], "OPEN": []},
            "note": f"The scholarship search came back empty ({detail}). Try again in "
                    f"a moment, and check {SCHOLARSHIP_UNIVERSE} in the meantime.",
            "total": 0,
            "sources": [],
        }

    parsed = _ask_gemini(build_instruction(student, today), results, query)
    if not parsed:
        return {
            "configured": True,
            "groups": {"URGENT": [], "UPCOMING": [], "OPEN": []},
            "note": "Found sources, but could not summarize them. Please try again.",
            "total": 0,
            "sources": [{"title": r["title"], "url": r["url"]} for r in results[:8]],
        }

    groups = _group_by_urgency(parsed.get("items") or [])
    return {
        "configured": True,
        "groups": groups,
        "note": parsed.get("note", ""),
        "total": sum(len(v) for v in groups.values()),
        "sources": [{"title": r["title"], "url": r["url"]} for r in results[:8]],
    }
