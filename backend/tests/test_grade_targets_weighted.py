"""Weighted "what do I need?" targets, when a group is only half graded.

`_calc_weighted_targets` used to add a group's FULL weight to the already-earned
side whenever it had any graded work, and its FULL weight again to the remaining
side whenever it had any ungraded work. A group holding both was therefore
counted twice, and the code comment said as much ("Some weight may overlap")
while applying no correction. The required average came out wrong for exactly
the case a student checks most: mid-semester, with a category part-finished.

These tests pin the split-by-points behaviour: a group's weight is divided
between earned and remaining in proportion to its points.
"""
from services.canvas_analytics import _calc_weighted_targets, _calc_weighted_grade


def _group(name, weight, graded_earned, graded_possible, remaining_possible):
    return {
        "id": name,
        "name": name,
        "weight": weight,
        "assignments": [],
        "graded_earned": float(graded_earned),
        "graded_possible": float(graded_possible),
        "remaining_possible": float(remaining_possible),
        "graded_count": 0,
        "total_count": 0,
    }


# --- the clean case: every group is finished or untouched ------------------

def test_clean_split_is_unchanged():
    """Homework (30%) fully graded at 90%, Exams (70%) untouched.

    An A needs (90*100 - 90*30) / 70 = 90% on the exams. This case never had
    overlap, so the fix must not move it.
    """
    groups = {
        "hw": _group("Homework", 30, 90, 100, 0),
        "ex": _group("Exams", 70, 0, 0, 200),
    }
    res = _calc_weighted_targets(groups, _calc_weighted_grade(groups))
    assert res["for_A"]["required_avg"] == 90.0
    assert res["for_C"]["required_avg"] == 61.4
    assert res["for_A"]["achievable"] is True


# --- the bug: one group holds both graded and remaining work --------------

def test_group_with_graded_and_remaining_is_not_double_counted():
    """One single group, 100% of the grade, half its points graded at 80%.

    With the whole class in one group the answer is forced: 200 points total,
    80 earned of the first 100, so an A (90% = 180 pts) needs 100 of the
    remaining 100 points -> 100%. The old code read the group as fully earned
    at 80% AND fully remaining, giving ((90*100) - 8000) / 100 = 10%.
    """
    groups = {"all": _group("All Work", 100, 80, 100, 100)}
    res = _calc_weighted_targets(groups, _calc_weighted_grade(groups))
    assert res["for_A"]["required_avg"] == 100.0
    assert res["for_B"]["required_avg"] == 80.0
    assert res["for_C"]["required_avg"] == 60.0


def test_partially_graded_group_alongside_a_clean_one():
    """Homework 40% (half graded at 100%), Exams 60% (untouched).

    Homework locks in 40% weight * 100% * (100/200 graded) = 2000, and leaves
    40% * (100/200) = 20 weight still winnable. Exams leave 60.
    An A needs (90*100 - 2000) / 80 = 87.5% on everything left.
    """
    groups = {
        "hw": _group("Homework", 40, 100, 100, 100),
        "ex": _group("Exams", 60, 0, 0, 300),
    }
    res = _calc_weighted_targets(groups, _calc_weighted_grade(groups))
    assert res["for_A"]["required_avg"] == 87.5


def test_impossible_target_still_flagged_unachievable():
    """A target needing more than 100% must be marked unreachable, not printed."""
    groups = {
        "hw": _group("Homework", 30, 50, 100, 0),
        "ex": _group("Exams", 70, 0, 0, 200),
    }
    res = _calc_weighted_targets(groups, _calc_weighted_grade(groups))
    assert res["for_A"]["required_avg"] > 100
    assert res["for_A"]["achievable"] is False
    assert res["for_C"]["achievable"] is True


def test_no_remaining_work_reports_achievability_from_current_grade():
    """Nothing left to submit: there is no average to hit, only a yes or no."""
    groups = {
        "hw": _group("Homework", 30, 90, 100, 0),
        "ex": _group("Exams", 70, 170, 200, 0),
    }
    res = _calc_weighted_targets(groups, _calc_weighted_grade(groups))
    assert res["for_A"]["required_avg"] is None
    assert res["for_A"]["achievable"] is False   # current is 86.5
    assert res["for_B"]["achievable"] is True


def test_group_with_no_points_at_all_does_not_skew_the_weight_base():
    """A weighted group the professor never populated must drop out entirely,
    not silently absorb 20% of the grade at zero."""
    groups = {
        "hw": _group("Homework", 30, 90, 100, 0),
        "ex": _group("Exams", 50, 0, 0, 200),
        "ghost": _group("Final Project", 20, 0, 0, 0),
    }
    res = _calc_weighted_targets(groups, _calc_weighted_grade(groups))
    # Base is 80, not 100: an A needs (90*80 - 90*30) / 50 = 90%.
    assert res["for_A"]["required_avg"] == 90.0
