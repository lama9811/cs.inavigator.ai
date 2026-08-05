from services.academic_calendar import (
    academic_year_for_semester,
    calendar_source_for_semester,
    parse_calendar_deadlines,
)


SAMPLE_CALENDAR = """
Academic Calendar 2026-2027*

Fall 2026

First Day of Class
August 26th (Wednesday)
Last Day to Add/Drop a Course / Cancel for the Semester
September 8th (Tuesday)
Last Day to Withdraw from an Individual Course
October 27th (Tuesday)
Last Day to Withdraw for the Semester
December 9th (Wednesday)

Spring 2027

First Day of Class
January 20th (Wednesday)
Last Day to Add/Drop a Course / Cancel for the Semester
February 2nd (Tuesday)
Last Day to Withdraw from an individual course
March 26th (Friday)
"""


def test_academic_year_for_semester():
    assert academic_year_for_semester("fall_2026") == "2026-2027"
    assert academic_year_for_semester("spring_2027") == "2026-2027"
    assert academic_year_for_semester("summer_2027") == "2026-2027"
    assert academic_year_for_semester("bad") is None


def test_calendar_source_for_known_semester():
    source = calendar_source_for_semester("fall_2026")
    assert source["fallback"] is False
    assert source["academic_year"] == "2026-2027"
    assert "docs.google.com" in source["url"]


def test_parse_fall_deadlines():
    deadlines = parse_calendar_deadlines(SAMPLE_CALENDAR, "fall_2026")
    assert deadlines["add_drop"]["date"] == "2026-09-08"
    assert deadlines["withdraw"]["date"] == "2026-10-27"
    assert "Add/Drop" in deadlines["add_drop"]["source_text"]


def test_parse_spring_deadlines():
    deadlines = parse_calendar_deadlines(SAMPLE_CALENDAR, "spring_2027")
    assert deadlines["add_drop"]["date"] == "2027-02-02"
    assert deadlines["withdraw"]["date"] == "2027-03-26"
