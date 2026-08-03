"""Every source that states a course prerequisite must state the SAME one.

Why this exists
---------------
The same course table is hand-copied across four KB documents plus
`data_sources/classes.json` (which drives the planner). Nothing checked that the
copies agreed, and they drifted: on 2026-08-03 a 50-question CS Nav evaluation
found ten courses whose prerequisites differed between documents.

The failure mode this catches is worse than a missing fact. A gap makes the agent
refuse and tell the student to call the department -- nobody is misinformed. A
contradiction retrieves cleanly from both sides, passes the grounding gate (the
claim really is sourced), and the model silently picks one. Asked "does COSC 241
need MATH 141 or MATH 241?" it answered MATH 241; asked "I have MATH 141, am I
eligible?" it answered yes. Both confident, both grounded, opposite advice on a
registration-blocking question.

Nothing downstream can detect that -- the grounding gate measures whether an
answer is supported, not whether the sources agree with each other. So the check
has to happen here, on the data, before it ships.
"""
import glob
import json
import os
import re

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
KB_DIR = os.path.join(_BACKEND, "kb_structured")
CLASSES_JSON = os.path.join(_BACKEND, "data_sources", "classes.json")

_COURSE = r"(?:COSC|CLCO|MATH)\s*\d{3}"
# A course heading, optionally a "Credits:" line, then the prerequisite line.
_BLOCK = re.compile(
    rf"((?:COSC|CLCO|MATH) \d{{3}})\b[^\n]*\n(?:[^\n]*\n)?([^\n]*[Pp]rerequisites?:\s*)([^\n|]*)"
)

# Prerequisites stated as prose conditions rather than course codes ("senior
# standing", "department chair permission"). Those are not course lists and are
# phrased differently by design, so they are out of scope for this check.
_NON_COURSE_ONLY = frozenset()


def _codes(value: str) -> frozenset:
    """Course codes named in a prerequisite string, normalized."""
    return frozenset(re.sub(r"\s+", " ", c) for c in re.findall(_COURSE, value))


def _stated_prereqs():
    """{course_code: {source_name: frozenset(prereq codes)}} across every source."""
    found = {}
    for path in sorted(glob.glob(os.path.join(KB_DIR, "*.json"))):
        with open(path) as fh:
            doc = json.load(fh)
        content = doc.get("content") or ""
        for match in _BLOCK.finditer(content):
            course, value = match.group(1), match.group(3)
            codes = _codes(value)
            if not codes and "none" in value.lower():
                codes = frozenset(["NONE"])
            if not codes:
                continue  # prose-only ("senior standing") -- out of scope
            found.setdefault(course, {})[os.path.basename(path)] = codes

    with open(CLASSES_JSON) as fh:
        for course in json.load(fh)["courses"]:
            codes = _codes(" ".join(course.get("prerequisites") or []))
            if not codes:
                # An explicitly empty list means "no prerequisite".
                if course.get("prerequisites") == []:
                    codes = frozenset(["NONE"])
                else:
                    continue
            found.setdefault(course["course_code"], {})["classes.json"] = codes
    return found


class TestPrerequisitesAgreeAcrossSources:
    def test_no_course_has_conflicting_prerequisites(self):
        conflicts = []
        for course, by_source in sorted(_stated_prereqs().items()):
            if len(set(by_source.values())) > 1:
                detail = "; ".join(
                    f"{src}={sorted(codes)}" for src, codes in sorted(by_source.items())
                )
                conflicts.append(f"{course}: {detail}")
        assert not conflicts, (
            "sources disagree on prerequisites -- the agent will give students "
            "contradictory answers depending on which document retrieves:\n  "
            + "\n  ".join(conflicts)
        )

    def test_the_cosc_241_math_prerequisite_is_math_241(self):
        """The specific row that produced contradictory advice.

        MATH 141 is never defined as a course anywhere in the KB; MATH 241
        (Calculus I) is defined and is one of the four required supporting
        courses. Two documents said MATH 141 and were corrected.
        """
        by_source = _stated_prereqs()["COSC 241"]
        assert by_source, "expected COSC 241 to appear in at least one source"
        for src, codes in by_source.items():
            assert "MATH 141" not in codes, f"{src} still lists MATH 141 for COSC 241"
            assert "MATH 241" in codes, f"{src} is missing MATH 241 for COSC 241"

    def test_every_source_is_covered(self):
        """Guard the guard: if the regex stops matching, the test above passes
        vacuously. At least the four catalog docs must still yield rows."""
        found = _stated_prereqs()
        sources = {s for by_source in found.values() for s in by_source}
        for required in (
            "academic_courses.json",
            "academic_11_course_prerequisites.json",
            "academic_degree_requirements_core.json",
            "classes.json",
        ):
            assert required in sources, f"parsed no prerequisites from {required}"
        assert len(found) >= 25, f"only parsed {len(found)} courses; regex likely broke"
