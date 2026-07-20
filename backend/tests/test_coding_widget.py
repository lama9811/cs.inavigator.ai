"""Source-level regression checks for the floating Coding Tutor integration.

The frontend currently has no JavaScript test runner. These focused checks protect the
session-routing and accessibility contracts that previously allowed widget replies to
leak into the regular chat.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CHATBOX = ROOT / "frontend" / "src" / "components" / "Chatbox.jsx"
CODING_TUTOR = ROOT / "frontend" / "src" / "components" / "coding-tutor" / "CodingTutor.jsx"
FLOATING_CHAT = ROOT / "frontend" / "src" / "components" / "coding-tutor" / "FloatingCodingChat.jsx"
PROFILE_PAGE = ROOT / "frontend" / "src" / "components" / "ProfilePage.jsx"
MAIN_API = ROOT / "backend" / "main.py"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_widget_bot_messages_keep_the_widget_session_metadata():
    source = read(CHATBOX)
    placeholder = source.split("// 3. Add placeholder bot message for streaming", 1)[1]
    placeholder = placeholder.split("// 4. Stream from Chat API", 1)[0]

    assert "...msgMeta" in placeholder
    assert 'surface: "widget"' in source
    assert "widgetSessionId" in source


def test_widget_retries_preserve_surface_session_and_attachment_context():
    source = read(CHATBOX)

    assert source.count("retryAttempt + 1") == 2
    assert source.count("tutorMessage") >= 5
    assert "window._lastRetried" not in source


def test_ai_code_suggestion_is_scoped_to_the_current_widget_session():
    source = read(CODING_TUTOR)
    feedback = source.split("const latestFeedback", 1)[1].split("const suggestedCodeBlock", 1)[0]

    assert 'msg.mode === "coding_tutor"' in feedback
    assert 'msg.surface === "widget"' in feedback
    assert "msg.widgetSessionId === currentWidgetSessionId" in feedback


def test_floating_chat_exposes_history_and_accessibility_controls():
    source = read(FLOATING_CHAT)

    assert 'role="log"' in source
    assert 'aria-live="polite"' in source
    assert "Show {Math.min(20, hiddenMessageCount)} earlier messages" in source
    assert 'aria-label="Attach code or notes"' in source
    assert 'aria-label="Start voice input"' in source


def test_coding_tutor_learning_style_is_saved_and_used_in_context():
    main_source = read(MAIN_API)
    profile_source = read(PROFILE_PAGE)
    tutor_source = read(CODING_TUTOR)
    chatbox_source = read(CHATBOX)

    assert '"/api/coding/preferences"' in main_source
    assert "CodingTutorPreference" in main_source
    assert "try_then_hint" in main_source

    assert "Coding Tutor preferences" in profile_source
    assert "CODING_LEARNING_STYLES" in profile_source
    assert "/api/coding/preferences" in profile_source

    assert "LEARNING_STYLE_COPY" in tutor_source
    assert "learningStyleInstruction" in tutor_source
    assert "openRecommendedTopic" in tutor_source

    assert "Learning preference:" in chatbox_source
    assert "How to adapt:" in chatbox_source
