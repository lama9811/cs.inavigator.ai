"""Regression checks for gated Coding Tutor hints and reference solutions."""

from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
MAIN_API = ROOT / "backend" / "main.py"
CODING_TUTOR = ROOT / "frontend" / "src" / "components" / "coding-tutor" / "CodingTutor.jsx"
CHATBOX = ROOT / "frontend" / "src" / "components" / "Chatbox.jsx"
APP = ROOT / "frontend" / "src" / "App.jsx"
WORKSPACE_DRAFT = ROOT / "frontend" / "src" / "components" / "coding-tutor" / "workspaceDraft.js"
TERMINAL_PANEL = ROOT / "frontend" / "src" / "components" / "coding-tutor" / "TerminalPanel.jsx"
TERMINAL_CSS = ROOT / "frontend" / "src" / "components" / "coding-tutor" / "TerminalPanel.css"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("attempts", "solved", "expected"),
    [
        (0, False, 1),
        (1, False, 2),
        (2, False, 3),
        (3, False, 4),
        (0, True, 4),
    ],
)
def test_hint_unlock_count_progresses_by_attempts(attempts, solved, expected):
    from main import _hint_unlock_count

    assert _hint_unlock_count(attempts, solved) == expected


def test_workspace_uses_materials_before_gated_solution():
    source = read(CODING_TUTOR)

    assert "/materials?language=" in source
    assert "/solution?language=" in source
    assert "loadUnlockedReferenceSolution" in source
    assert "solution_unlocked" in source


def test_passing_solution_review_shows_a_line_diff():
    panel_source = read(TERMINAL_PANEL)
    css_source = read(TERMINAL_CSS)

    assert "buildLineDiff" in panel_source
    assert "terminal-solution-diff" in panel_source
    assert 'className={`diff-line ${line.type}`}' in panel_source
    assert ".terminal-solution-diff .diff-line.added" in css_source
    assert ".terminal-solution-diff .diff-line.removed" in css_source


def test_solution_endpoint_requires_auth_and_locks_before_three_attempts():
    source = read(MAIN_API)
    solution_endpoint = source.split('@app.get("/api/coding/practice/questions/{question_id}/solution")', 1)[1]
    solution_endpoint = solution_endpoint.split("# ---------------------------------------------------------------------------", 1)[0]

    assert "Depends(get_current_user)" in solution_endpoint
    assert 'status_code=423' in solution_endpoint
    assert "solution_required_attempts" in source
    assert "attempt_count >= 3" in source


def test_hint_requests_are_recorded_server_side_and_sent_to_chat_context():
    main_source = read(MAIN_API)
    tutor_source = read(CODING_TUTOR)
    chatbox_source = read(CHATBOX)

    assert '"/api/coding/practice/questions/{question_id}/hints/request"' in main_source
    assert "CodingHintEvent" in main_source
    assert "/hints/request" in tutor_source
    assert "hintState" in tutor_source
    assert "Hint ladder state:" in chatbox_source


def test_workspace_state_syncs_last_problem_and_prefers_newer_drafts():
    main_source = read(MAIN_API)
    tutor_source = read(CODING_TUTOR)
    draft_source = read(WORKSPACE_DRAFT)

    assert '"/api/coding/workspace-state"' in main_source
    assert "CodingWorkspaceState" in main_source
    assert "saveWorkspaceState(problem.id, language, \"practice\")" in tutor_source
    assert "saveWorkspaceState(question.id, openedLanguageKey, \"interview\")" in tutor_source
    assert "loadWorkspaceState" in tutor_source
    assert "chooseWorkspaceCode" in tutor_source
    assert "Date.parse(serverProgress?.updated_at || \"\")" in tutor_source
    assert "export function readDraftEntry" in draft_source


def test_coding_chat_history_preserves_widget_metadata():
    app_source = read(APP)

    assert 'String(sid).startsWith("coding-")' in app_source
    assert 'surface: "widget"' in app_source
    assert 'widgetSessionId: sid' in app_source
