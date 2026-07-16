"""Tests for the scholarship & internship search service.

The two properties that matter most, and are easiest to regress:
  1. A missing TAVILY_API_KEY must NEVER crash. The original ADK tool raised at
     client construction, which would take the app down on startup. Here it has to
     degrade to a reportable "not configured" state.
  2. Expired opportunities must NEVER reach a student. The prompt asks the model to
     drop them, but we enforce it in code — an LLM cannot be trusted with date math,
     and showing a dead deadline is worse than showing nothing.
"""

import os
from datetime import date, timedelta
from unittest.mock import patch

import pytest

from services import scholarship_search as ss


def _iso(days_from_today: int) -> str:
    return (date.today() + timedelta(days=days_from_today)).strftime("%Y-%m-%d")


# --- check_deadline ----------------------------------------------------------

@pytest.mark.parametrize("offset,expected", [
    (-30, "EXPIRED"),
    (-1, "EXPIRED"),
    (0, "TODAY"),
    (1, "URGENT"),
    (7, "URGENT"),      # boundary: <= 7 days is urgent
    (8, "UPCOMING"),    # boundary: 8 days is not
    (30, "UPCOMING"),   # boundary: <= 30 days is upcoming
    (31, "OPEN"),       # boundary: 31 days is open
    (400, "OPEN"),
])
def test_check_deadline_buckets(offset, expected):
    assert ss.check_deadline(_iso(offset))["status"] == expected


def test_check_deadline_days_remaining_is_signed():
    assert ss.check_deadline(_iso(-5))["days_remaining"] == -5
    assert ss.check_deadline(_iso(12))["days_remaining"] == 12


@pytest.mark.parametrize("bad", ["", "not-a-date", "12/25/2026", "(not listed)", None, 20260101])
def test_check_deadline_rejects_garbage(bad):
    """Bad input returns INVALID rather than raising — the model WILL send junk."""
    assert ss.check_deadline(bad)["status"] == "INVALID"


# --- configuration -----------------------------------------------------------

def test_not_configured_without_key(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    assert ss.is_configured() is False


def test_blank_key_is_not_configured(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "   ")
    assert ss.is_configured() is False


def test_configured_with_key(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    assert ss.is_configured() is True


def test_missing_key_degrades_instead_of_raising(monkeypatch):
    """With NO live source at all (grounding off + no Tavily key), the request must
    not blow up — it falls back to the curated core, so results still come."""
    monkeypatch.setenv("SCHOLARSHIP_USE_GROUNDING", "false")
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    result = ss.find_opportunities("scholarships", {"gpa": 3.4})
    assert result["configured"] is False             # no live search available
    assert result["total"] > 0                       # curated core still served
    assert "curated" in result["note"].lower()


def test_web_search_without_key_returns_error_dict(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    out = ss.web_search("anything")
    assert out["results"] == []
    assert "error" in out


# --- failure paths -----------------------------------------------------------

def test_tavily_exception_is_swallowed(monkeypatch):
    """A Tavily outage returns an error dict, never an exception."""
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    with patch("tavily.TavilyClient") as client:
        client.return_value.search.side_effect = RuntimeError("connection reset")
        out = ss.web_search("scholarships")
    assert out["results"] == []
    assert "connection reset" in out["error"]


def test_search_failure_returns_curated_not_500(monkeypatch):
    """A Tavily quota error falls back to the curated core, not an empty page.
    (Grounding off so we test the Tavily path deterministically, offline.)"""
    monkeypatch.setenv("SCHOLARSHIP_USE_GROUNDING", "false")
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    ss.clear_cache()
    with patch.object(ss, "web_search", return_value={"error": "quota exceeded", "results": []}):
        result = ss.find_opportunities("scholarships", {})
    assert result["configured"] is True
    assert result["total"] > 0                       # curated core carries it
    assert "curated" in result["note"].lower()


def test_gemini_failure_still_returns_sources(monkeypatch):
    """If the model can't summarize, the student still gets curated items + raw links.
    (Grounding off so the Tavily fetch-then-summarize path runs.)"""
    monkeypatch.setenv("SCHOLARSHIP_USE_GROUNDING", "false")
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    ss.clear_cache()
    hits = {"results": [{"title": "UNCF", "url": "https://uncf.org", "snippet": "s", "published_date": None}]}
    with patch.object(ss, "web_search", return_value=hits), \
         patch.object(ss, "_ask_gemini", return_value=None):
        result = ss.find_opportunities("scholarships", {})
    assert result["total"] > 0                        # curated core present
    assert result["sources"][0]["url"] == "https://uncf.org"


# --- urgency grouping (the safety-critical bit) ------------------------------

def test_expired_opportunities_are_dropped():
    """A student must never be shown an award that already closed."""
    groups = ss._group_by_urgency([
        {"name": "Closed last month", "deadline": _iso(-30)},
        {"name": "Closed yesterday", "deadline": _iso(-1)},
        {"name": "Still open", "deadline": _iso(45)},
    ])
    names = [i["name"] for bucket in groups.values() for i in bucket]
    assert names == ["Still open"]


def test_items_land_in_the_right_bucket():
    groups = ss._group_by_urgency([
        {"name": "Soon", "deadline": _iso(3)},
        {"name": "Later", "deadline": _iso(20)},
        {"name": "Far off", "deadline": _iso(90)},
    ])
    assert [i["name"] for i in groups["URGENT"]] == ["Soon"]
    assert [i["name"] for i in groups["UPCOMING"]] == ["Later"]
    assert [i["name"] for i in groups["OPEN"]] == ["Far off"]


def test_due_today_is_urgent_not_dropped():
    groups = ss._group_by_urgency([{"name": "Due today", "deadline": _iso(0)}])
    assert [i["name"] for i in groups["URGENT"]] == ["Due today"]


def test_undated_items_are_kept_as_open():
    """Rolling deadlines and '(not listed)' are still useful — keep, don't drop."""
    groups = ss._group_by_urgency([
        {"name": "Rolling", "deadline": "(not listed)"},
        {"name": "Missing"},
    ])
    assert {i["name"] for i in groups["OPEN"]} == {"Rolling", "Missing"}
    assert all(i["days_remaining"] is None for i in groups["OPEN"])


def test_soonest_deadline_sorts_first():
    groups = ss._group_by_urgency([
        {"name": "Day 6", "deadline": _iso(6)},
        {"name": "Day 2", "deadline": _iso(2)},
        {"name": "Day 4", "deadline": _iso(4)},
    ])
    assert [i["name"] for i in groups["URGENT"]] == ["Day 2", "Day 4", "Day 6"]


def test_undated_items_sink_below_dated_ones():
    groups = ss._group_by_urgency([
        {"name": "Rolling", "deadline": "(not listed)"},
        {"name": "Dated", "deadline": _iso(60)},
    ])
    assert [i["name"] for i in groups["OPEN"]] == ["Dated", "Rolling"]


def test_recommended_items_lead_the_open_bucket():
    """Curated (recommended) awards sort ahead of non-curated undated ones — most
    curated awards are rolling, and they're the vetted picks worth surfacing."""
    groups = ss._group_by_urgency([
        {"name": "Random live award", "deadline": "(not listed)"},
        {"name": "Curated pick", "deadline": "(not listed)", "curated": True},
    ])
    assert [i["name"] for i in groups["OPEN"]] == ["Curated pick", "Random live award"]


def test_a_real_close_deadline_still_beats_a_recommended_rolling_one():
    """'Closest deadline first' wins across buckets: an URGENT dated award outranks
    a recommended rolling one, which lands in OPEN."""
    groups = ss._group_by_urgency([
        {"name": "Curated rolling", "deadline": "(not listed)", "curated": True},
        {"name": "Due in 5 days", "deadline": _iso(5)},
    ])
    order = [i["name"] for b in ("URGENT", "UPCOMING", "OPEN") for i in groups[b]]
    assert order[0] == "Due in 5 days"


def test_malformed_items_are_skipped():
    """The model can emit junk; grouping must not raise on it."""
    groups = ss._group_by_urgency([
        {"name": "Good", "deadline": _iso(10)},
        {"no_name": "bad"},
        "not a dict",
        None,
    ])
    names = [i["name"] for bucket in groups.values() for i in bucket]
    assert names == ["Good"]


# --- student profile ---------------------------------------------------------

def test_profile_reads_the_real_degreeworks_columns():
    """GPA lives in `overall_gpa`, not `gpa`. Getting this wrong silently disables
    the eligibility filter, which is the feature's entire value."""
    student = ss.build_student_profile(
        {"overall_gpa": 3.4, "degree_program": "BS Computer Science",
         "classification": "Junior", "minor": "Math"},
        {"name": "Test Student", "major": "Computer Science"},
    )
    assert student["gpa"] == 3.4
    assert student["major"] == "BS Computer Science"   # DegreeWorks beats the profile
    assert student["classification"] == "Junior"


def test_profile_handles_no_degreeworks():
    student = ss.build_student_profile(None, {"major": "Computer Science"})
    assert "gpa" not in student
    assert student["major"] == "Computer Science"


def test_profile_skips_empty_and_na_values():
    student = ss.build_student_profile(
        {"overall_gpa": None, "degree_program": "", "classification": "N/A"}, None
    )
    assert student == {}


def test_instruction_asks_for_missing_data():
    """With no DegreeWorks, the prompt must ask rather than invent an eligibility."""
    text = ss.build_instruction({}, ss.get_current_date())
    assert "No DegreeWorks data" in text
    assert "Ask for their GPA" in text


def test_instruction_carries_the_eligibility_filter():
    text = ss.build_instruction({"gpa": 3.2}, ss.get_current_date())
    assert "3.2" in text
    assert "SILENTLY" in text          # never explain why an award was skipped
    assert "NEVER show expired" in text


# --- JSON extraction ---------------------------------------------------------

def test_extracts_json_from_a_markdown_fence():
    assert ss._extract_json('```json\n{"items": []}\n```') == {"items": []}


def test_extracts_bare_json():
    assert ss._extract_json('{"items": [{"name": "X"}]}')["items"][0]["name"] == "X"


def test_extracts_json_surrounded_by_prose():
    """Models add "Here you go:" even when told not to."""
    assert ss._extract_json('Here you go:\n{"items": []}\nHope that helps!') == {"items": []}


@pytest.mark.parametrize("junk", ["", "no json here", "{broken", "[1, 2, 3]"])
def test_unparseable_output_returns_none(junk):
    assert ss._extract_json(junk) is None


# --- date helper -------------------------------------------------------------

def test_get_current_date_shape():
    today = ss.get_current_date()
    assert today["date"] == date.today().strftime("%Y-%m-%d")
    assert today["semester"].split()[0] in ("Spring", "Summer", "Fall")
    assert today["year"] == date.today().year


# --- saved opportunities: dedupe key -----------------------------------------
# Saving is what turns the search box into a feature. The two properties that
# matter: the same award saved twice collapses to one row, and a saved item's
# urgency is recomputed from *today*, not frozen at save time.

def test_client_key_is_stable_for_the_same_award():
    a = ss.client_key_for("UNCF Scholarship", "https://uncf.org/apply")
    b = ss.client_key_for("UNCF Scholarship", "https://uncf.org/apply")
    assert a == b


def test_client_key_ignores_case_and_whitespace():
    """A re-save from a later search shouldn't duplicate just because the model
    capitalized differently or added a trailing space."""
    a = ss.client_key_for("UNCF Scholarship", "https://uncf.org")
    b = ss.client_key_for("  uncf scholarship ", "HTTPS://UNCF.ORG")
    assert a == b


def test_client_key_differs_by_name_and_url():
    base = ss.client_key_for("Award A", "https://a.org")
    assert base != ss.client_key_for("Award B", "https://a.org")   # name differs
    assert base != ss.client_key_for("Award A", "https://b.org")   # url differs


def test_client_key_survives_missing_url():
    """Some awards have no apply link; the key must still be stable, not raise."""
    a = ss.client_key_for("Rolling Award", "")
    b = ss.client_key_for("Rolling Award", "")
    assert a == b and len(a) > 0


# --- saved opportunities: urgency recompute ----------------------------------

def test_recompute_urgency_tracks_today():
    assert ss.recompute_urgency(_iso(3))["status"] == "URGENT"
    assert ss.recompute_urgency(_iso(20))["status"] == "UPCOMING"
    assert ss.recompute_urgency(_iso(90))["status"] == "OPEN"


def test_recompute_urgency_flags_a_now_expired_save():
    """An item saved weeks ago whose deadline has since passed must read EXPIRED,
    so the frontend can dim it instead of pretending it's still open."""
    verdict = ss.recompute_urgency(_iso(-2))
    assert verdict["status"] == "EXPIRED"
    assert verdict["days_remaining"] == -2


def test_recompute_urgency_today_is_urgent():
    assert ss.recompute_urgency(_iso(0))["status"] == "URGENT"


@pytest.mark.parametrize("bad", ["", "(not listed)", None, "rolling"])
def test_recompute_urgency_undated_is_open(bad):
    verdict = ss.recompute_urgency(bad)
    assert verdict["status"] == "OPEN"
    assert verdict["days_remaining"] is None


# --- saved opportunities: validation vocab -----------------------------------

def test_valid_kinds_and_statuses_are_the_expected_sets():
    """The endpoint validates against these; a typo here silently breaks saving."""
    assert set(ss.VALID_KINDS) == {"scholarship", "internship"}
    assert set(ss.VALID_STATUSES) == {
        "interested", "applying", "submitted", "awarded", "rejected", "expired",
    }


# --- application checklists ---------------------------------------------------
# The checklist is what turns "saved" into "applied". The properties that matter:
# generation never fails hard (falls back to a template), items come back in the
# stored shape, and progress counts are junk-tolerant.

def test_default_checklist_differs_by_kind():
    sch = [i["label"] for i in ss.default_checklist("scholarship")]
    intern = [i["label"] for i in ss.default_checklist("internship")]
    assert sch != intern
    assert any("FAFSA" in x for x in sch)          # scholarship-specific
    assert any("resume" in x.lower() for x in intern)  # internship-specific


def test_default_checklist_items_have_the_stored_shape():
    for item in ss.default_checklist("scholarship"):
        assert set(item.keys()) == {"id", "label", "done", "note"}
        assert item["done"] is False and item["note"] == ""


def test_checklist_items_skips_blank_labels():
    items = ss._checklist_items(["Essay", "", "   ", "Transcript"])
    assert [i["label"] for i in items] == ["Essay", "Transcript"]


def test_generate_checklist_falls_back_when_ai_unavailable(monkeypatch):
    """When the AI call fails, generation must degrade to the template, not raise.

    We force the failure explicitly (a genai client that raises) rather than
    relying on genai being absent from the environment — the real package IS
    installed here, and other tests stub sys.modules, so an implicit-absence
    assumption is order-dependent and flaky.
    """
    import types as _t
    import sys

    class _BoomClient:
        def __init__(self, **_kw):
            raise RuntimeError("no Vertex credentials in test env")

    fake_genai = _t.SimpleNamespace(
        Client=_BoomClient,
        types=_t.SimpleNamespace(GenerateContentConfig=lambda **_kw: None),
    )
    monkeypatch.setitem(sys.modules, "google", _t.SimpleNamespace(genai=fake_genai))
    monkeypatch.setitem(sys.modules, "google.genai", fake_genai)

    item = {"kind": "scholarship", "name": "UNCF", "eligibility": "3.0 GPA"}
    result = ss.generate_checklist(item)
    assert result == ss.default_checklist("scholarship")


def _install_fake_genai(monkeypatch):
    """Stub out `from google import genai` / `from google.genai import types`.

    generate_checklist does `from google import genai` then
    `from google.genai import types`, so `types` must be an ATTRIBUTE of the
    google.genai module object (not just a separate sys.modules entry). We set
    both so either import form resolves.
    """
    import types as _t
    import sys

    class _Resp:
        text = "ignored — _extract_json is patched"

    class _Models:
        def generate_content(self, **_kw):
            return _Resp()

    class _Client:
        models = _Models()

    fake_types = _t.SimpleNamespace(GenerateContentConfig=lambda **_kw: None)
    fake_genai = _t.SimpleNamespace(
        Client=lambda **_kw: _Client(),
        types=fake_types,               # so `from google.genai import types` works
    )
    fake_google = _t.SimpleNamespace(genai=fake_genai)  # so `from google import genai` works

    monkeypatch.setitem(sys.modules, "google", fake_google)
    monkeypatch.setitem(sys.modules, "google.genai", fake_genai)
    monkeypatch.setitem(sys.modules, "google.genai.types", fake_types)


def test_generate_checklist_uses_ai_items_when_present(monkeypatch):
    """When the model returns items, they become the checklist (capped at 8)."""
    labels = [f"Requirement {n}" for n in range(12)]
    monkeypatch.setattr(ss, "_extract_json", lambda _t: {"items": labels})
    _install_fake_genai(monkeypatch)

    result = ss.generate_checklist({"kind": "scholarship", "name": "X"})
    assert len(result) == 8                            # capped
    assert result[0]["label"] == "Requirement 0"
    assert all(set(i) == {"id", "label", "done", "note"} for i in result)


def test_generate_checklist_falls_back_on_empty_ai_result(monkeypatch):
    monkeypatch.setattr(ss, "_extract_json", lambda _t: {"items": []})
    _install_fake_genai(monkeypatch)

    result = ss.generate_checklist({"kind": "internship", "name": "STEP"})
    assert result == ss.default_checklist("internship")


# --- checklist progress ------------------------------------------------------

def test_checklist_progress_counts_done_and_total():
    checklist = [
        {"label": "a", "done": True},
        {"label": "b", "done": False},
        {"label": "c", "done": True},
    ]
    assert ss.checklist_progress(checklist) == {"done": 2, "total": 3}


def test_checklist_progress_is_empty_for_none():
    assert ss.checklist_progress(None) == {"done": 0, "total": 0}


def test_checklist_progress_ignores_junk_items():
    """A labelless or non-dict entry doesn't count toward the total."""
    checklist = [
        {"label": "real", "done": True},
        {"done": True},          # no label — junk
        "not a dict",            # junk
        {"label": "", "done": True},  # blank label — junk
    ]
    assert ss.checklist_progress(checklist) == {"done": 1, "total": 1}


# --- curated core database ---------------------------------------------------
# The zero-cost layer. Properties that matter: it loads real awards, it filters
# by GPA conservatively, and it's always available even with no Tavily key.

def test_curated_file_loads_real_awards():
    data = ss._load_curated()
    assert len(data["scholarships"]) >= 5
    assert len(data["internships"]) >= 5


def test_curated_items_have_urls_and_names():
    """Never invent a link: every curated award must carry a real URL and name."""
    for entry in ss.curated_opportunities({}):
        assert entry["name"]
        assert entry["url"] and entry["url"].startswith("http")


def test_curated_filters_out_awards_above_the_students_gpa():
    """A 2.0 student shouldn't see a 3.5-minimum award; a 3.9 student should."""
    low = {n["name"] for n in ss.curated_opportunities({"gpa": 2.0})}
    high = {n["name"] for n in ss.curated_opportunities({"gpa": 3.9})}
    # The high-GPA student sees at least as many as the low-GPA one.
    assert high >= low
    # And strictly more, because some awards carry a 3.0+ minimum.
    assert len(high) > len(low)


def test_curated_keeps_awards_when_gpa_unknown():
    """Missing GPA must not hide awards — better shown than wrongly filtered."""
    none_known = ss.curated_opportunities({})
    high = ss.curated_opportunities({"gpa": 4.0})
    assert len(none_known) == len(high)


def test_curated_available_without_any_live_source(monkeypatch):
    """The whole point of the curated core: it works with no live search at all."""
    monkeypatch.setenv("SCHOLARSHIP_USE_GROUNDING", "false")
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    result = ss.find_opportunities("scholarships", {"gpa": 3.5})
    assert result["configured"] is False
    assert result["total"] > 0                       # curated still returned
    names = [i["name"] for b in result["groups"].values() for i in b]
    assert any("UNCF" in n or "Google" in n for n in names)


# --- shared result cache -----------------------------------------------------

def test_merge_dedupes_curated_and_live():
    """A curated 'Google STEP' and a live 'Google STEP Internship' collapse to one."""
    curated = [{"name": "Google STEP", "deadline": "(not listed)"}]
    live = [
        {"name": "Google STEP Internship", "deadline": "(not listed)"},
        {"name": "Some Other Award", "deadline": "(not listed)"},
    ]
    groups = ss._merge_and_group(curated, live)
    names = [i["name"] for b in groups.values() for i in b]
    assert "Google STEP" in names
    assert "Google STEP Internship" not in names      # deduped against curated
    assert "Some Other Award" in names


def test_cache_key_buckets_similar_students():
    """Two students with GPAs in the same half-point band share a cache entry."""
    a = ss._cache_key("cs scholarships", {"gpa": 3.4, "major": "CS", "classification": "Junior"})
    b = ss._cache_key("cs scholarships", {"gpa": 3.2, "major": "CS", "classification": "Junior"})
    assert a == b       # 3.4 and 3.2 both floor to the 3.0 band


def test_cache_stores_and_expires(monkeypatch):
    """A cached live result is served within TTL and dropped after it.

    Grounding is forced off here so the deterministic Tavily path is exercised;
    the cache behavior is identical whichever live source produced the items.
    """
    monkeypatch.setenv("SCHOLARSHIP_USE_GROUNDING", "false")
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    ss.clear_cache()

    hits = {"results": [{"title": "UNCF", "url": "https://uncf.org", "snippet": "s", "published_date": None}]}
    parsed = {"items": [{"name": "Live Award", "deadline": _iso(20)}], "note": "n"}

    calls = {"web": 0}

    def _counting_search(*_a, **_k):
        calls["web"] += 1
        return hits

    monkeypatch.setattr(ss, "web_search", _counting_search)
    monkeypatch.setattr(ss, "_ask_gemini", lambda *_a, **_k: parsed)

    student = {"gpa": 3.5, "major": "CS"}
    r1 = ss.find_opportunities("scholarships", student, now=1000.0)
    assert r1.get("cached") is False and calls["web"] > 0
    first_calls = calls["web"]

    # Second identical search within TTL: served from cache, no new web calls.
    r2 = ss.find_opportunities("scholarships", student, now=1000.0 + 60)
    assert r2.get("cached") is True
    assert calls["web"] == first_calls              # no extra Tavily bill

    # After TTL: cache miss, web is hit again.
    r3 = ss.find_opportunities("scholarships", student, now=1000.0 + ss.CACHE_TTL_SECONDS + 10)
    assert r3.get("cached") is False
    assert calls["web"] > first_calls


# --- live search: grounding primary, Tavily fallback -------------------------
# The plan's option (c): free Gemini google_search grounding is the default live
# source, Tavily only a fallback. The chain: grounding -> Tavily -> curated core.

def test_grounding_is_on_by_default(monkeypatch):
    monkeypatch.delenv("SCHOLARSHIP_USE_GROUNDING", raising=False)
    assert ss.grounding_enabled() is True


def test_grounding_can_be_disabled(monkeypatch):
    monkeypatch.setenv("SCHOLARSHIP_USE_GROUNDING", "false")
    assert ss.grounding_enabled() is False


def test_grounding_result_is_used_and_tavily_not_called(monkeypatch):
    """When grounding returns items, Tavily is never touched — that's the free path."""
    monkeypatch.setenv("SCHOLARSHIP_USE_GROUNDING", "true")
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    ss.clear_cache()

    with patch.object(ss, "grounded_search",
                      return_value={"items": [{"name": "Grounded Award", "deadline": _iso(15)}], "note": "g"}), \
         patch.object(ss, "web_search") as web:
        result = ss.find_opportunities("scholarships", {"gpa": 3.5}, now=10.0)

    names = [i["name"] for b in result["groups"].values() for i in b]
    assert "Grounded Award" in names
    assert not web.called                          # no Tavily bill when grounding works


def test_falls_back_to_tavily_when_grounding_empty(monkeypatch):
    """Grounding returning nothing must fall through to Tavily (if a key is set)."""
    monkeypatch.setenv("SCHOLARSHIP_USE_GROUNDING", "true")
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    ss.clear_cache()

    hits = {"results": [{"title": "T", "url": "https://t.org", "snippet": "s", "published_date": None}]}
    with patch.object(ss, "grounded_search", return_value=None), \
         patch.object(ss, "web_search", return_value=hits), \
         patch.object(ss, "_ask_gemini",
                      return_value={"items": [{"name": "Tavily Award", "deadline": _iso(15)}], "note": ""}):
        result = ss.find_opportunities("scholarships", {"gpa": 3.5}, now=20.0)

    names = [i["name"] for b in result["groups"].values() for i in b]
    assert "Tavily Award" in names


def test_curated_carries_when_both_live_sources_fail(monkeypatch):
    """Grounding fails AND Tavily fails -> the curated core still fills the page."""
    monkeypatch.setenv("SCHOLARSHIP_USE_GROUNDING", "true")
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-fake")
    ss.clear_cache()

    with patch.object(ss, "grounded_search", return_value=None), \
         patch.object(ss, "web_search", return_value={"error": "down", "results": []}):
        result = ss.find_opportunities("scholarships", {"gpa": 3.5}, now=30.0)

    assert result["total"] > 0                     # curated core carries it


def test_live_available_via_grounding_without_any_key(monkeypatch):
    """With grounding on and no Tavily key, live search is still 'available'."""
    monkeypatch.setenv("SCHOLARSHIP_USE_GROUNDING", "true")
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    ss.clear_cache()

    with patch.object(ss, "grounded_search",
                      return_value={"items": [{"name": "Free Grounded", "deadline": "(not listed)"}], "note": ""}):
        result = ss.find_opportunities("scholarships", {"gpa": 3.5}, now=40.0)

    assert result["configured"] is True            # grounding counts as configured
    names = [i["name"] for b in result["groups"].values() for i in b]
    assert "Free Grounded" in names


# --- expanded curated database -----------------------------------------------

def test_curated_database_is_sizeable():
    """The curated core should carry the page on its own; keep it well-stocked."""
    data = ss._load_curated()
    total = len(data["scholarships"]) + len(data["internships"])
    assert total >= 30, f"curated core is thin ({total} awards)"


def test_curated_entries_are_well_formed():
    """Never ship an award without a real name and a real link."""
    data = ss._load_curated()
    for entry in [*data["scholarships"], *data["internships"]]:
        assert entry.get("name"), f"unnamed curated entry: {entry.get('id')}"
        assert str(entry.get("url", "")).startswith("http"), \
            f"curated entry missing a real URL: {entry.get('id')}"


# --- deadline nudges (select_due_scholarship_reminders) ----------------------

def _saved(sid, offset_days, status="interested", **extra):
    """Build a saved-item dict with a deadline `offset_days` from today."""
    item = {"id": sid, "name": f"Award {sid}", "kind": "scholarship",
            "deadline": _iso(offset_days), "status": status}
    item.update(extra)
    return item


def test_reminder_selects_item_inside_the_window():
    """A future deadline within the lead window (default 7d) is picked."""
    due = ss.select_due_scholarship_reminders([_saved(1, 3)], set())
    assert len(due) == 1
    assert due[0]["item"]["id"] == 1
    assert due[0]["days_remaining"] == 3
    assert due[0]["key"] == ss.scholarship_reminder_key(1, _iso(3))


def test_reminder_skips_deadline_today_and_expired():
    """0 days (today) and negative (expired) are outside 0 < days <= lead."""
    items = [_saved(1, 0), _saved(2, -5)]
    assert ss.select_due_scholarship_reminders(items, set()) == []


def test_reminder_skips_beyond_the_window():
    """A deadline further out than the lead window is not nudged yet."""
    assert ss.select_due_scholarship_reminders([_saved(1, 20)], set()) == []


def test_reminder_respects_custom_lead_days():
    """A wider lead window pulls in a further-out deadline."""
    due = ss.select_due_scholarship_reminders([_saved(1, 20)], set(), lead_days=30)
    assert len(due) == 1


@pytest.mark.parametrize("status", ["submitted", "awarded", "rejected", "expired"])
def test_reminder_skips_terminal_statuses(status):
    """Don't nudge an award the student is already done with."""
    assert ss.select_due_scholarship_reminders([_saved(1, 3, status=status)], set()) == []


def test_reminder_is_case_insensitive_on_status():
    """Terminal-status check is lowercased, so 'Submitted' still skips."""
    assert ss.select_due_scholarship_reminders([_saved(1, 3, status="Submitted")], set()) == []


def test_reminder_dedupes_via_sent_keys():
    """An already-sent key is not selected again (idempotent dispatch)."""
    key = ss.scholarship_reminder_key(1, _iso(3))
    assert ss.select_due_scholarship_reminders([_saved(1, 3)], {key}) == []


def test_reminder_key_changes_when_deadline_moves():
    """Editing the deadline changes the key so one fresh nudge is sent."""
    assert ss.scholarship_reminder_key(1, "2026-01-01") != ss.scholarship_reminder_key(1, "2026-02-01")


def test_reminder_key_is_prefixed_to_avoid_canvas_collision():
    """Shares the SentReminder ledger with Canvas keys but never collides."""
    assert ss.scholarship_reminder_key(1, "2026-01-01").startswith("sch:")


def test_reminder_sorts_soonest_first():
    """Nudges come back ordered by days remaining."""
    items = [_saved(1, 6), _saved(2, 2), _saved(3, 4)]
    due = ss.select_due_scholarship_reminders(items, set())
    assert [d["item"]["id"] for d in due] == [2, 3, 1]


def test_reminder_skips_missing_or_junk_deadline():
    """A missing or unparseable deadline is simply skipped, not crashed on."""
    items = [{"id": 1, "status": "interested"},  # no deadline
             {"id": 2, "status": "interested", "deadline": "not-a-date"}]
    assert ss.select_due_scholarship_reminders(items, set()) == []


def test_reminder_tolerates_non_dict_rows():
    """Junk in the list is ignored, not fatal."""
    assert ss.select_due_scholarship_reminders([None, "x", _saved(1, 3)], set())[0]["item"]["id"] == 1
