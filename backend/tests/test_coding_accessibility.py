"""Source-level regression checks for Coding Tutor accessibility wiring."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CODING_TUTOR_DIR = ROOT / "frontend" / "src" / "components" / "coding-tutor"


def read(relative: str) -> str:
    return (CODING_TUTOR_DIR / relative).read_text(encoding="utf-8")


def test_learn_language_cards_are_native_buttons():
    source = read("learn/LearnMode.jsx")

    assert 'className={`cq-language-card ${recommended ? "recommended" : ""}`}' in source
    assert '<button\n              type="button"\n              key={lang.id}' in source
    assert 'role="button"' not in source


def test_main_modal_surfaces_use_focus_traps_and_modal_labels():
    modal_sources = [
        "CampusLabHome.jsx",
        "QuizBank.jsx",
        "WorkspaceVisualizer.jsx",
        "CodeWorkspace.jsx",
        "learn/LessonView.jsx",
        "MockSummary.jsx",
        "MockConfirm.jsx",
        "concept-quiz/PlacementCheck.jsx",
    ]

    for relative in modal_sources:
        source = read(relative)
        assert "useFocusTrap" in source, relative
        assert 'aria-modal="true"' in source, relative
        assert "aria-labelledby=" in source, relative


def test_tab_groups_have_roving_keyboard_navigation():
    checks = {
        "CodingTutor.jsx": "practice-mode-toggle",
        "CodeWorkspace.jsx": "workspace-tabs",
        "concept-quiz/QuizRunner.jsx": "cq-tabs",
    }

    for relative, class_name in checks.items():
        source = read(relative)
        assert "handleHorizontalRovingKeyDown" in source, relative
        assert 'role="tablist"' in source, relative
        assert class_name in source, relative


def test_floating_tutor_exposes_keyboard_movement_and_controls():
    source = read("FloatingCodingChat.jsx")

    assert 'aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"' in source
    assert 'aria-label="Move coding tutor window between corners with the arrow keys."' in source
    assert 'aria-label="Close tutor suggestion preview"' in source
