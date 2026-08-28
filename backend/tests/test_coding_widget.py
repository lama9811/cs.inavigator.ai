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


def test_floating_chat_has_concept_question_shortcut():
    source = read(FLOATING_CHAT)
    chatbox_source = read(CHATBOX)

    assert "Ask concept" in source
    assert 'onQuickAction("AskConcept")' in source
    assert "Ask about Big O, recursion, hash maps, syntax, or a language feature." in chatbox_source
    assert "Concept-question mode" in chatbox_source


def test_coding_tutor_routes_non_coding_questions_out_of_coding_mode():
    source = read(CHATBOX)

    assert "CODING_CONCEPT_RE" in source
    assert "hashmaps?" in source
    assert "CODING_MORGAN_ROUTE_RE" in source
    assert 'redirectMode: "regular"' in source
    assert 'redirectMode: "general"' in source
    assert "Current editor code is optional background" in source


def test_pending_chat_actions_respect_destination_mode():
    source = read(CHATBOX)

    assert "const pendingMode = pendingChatAction.mode" in source
    assert 'pendingMode === "coding_tutor" ? "widget" : "main"' in source
    assert '"coding_tutor", sessionId, "widget"' not in source


def test_full_coding_chat_route_renders_selected_history_messages():
    source = read(CHATBOX)
    app_source = read(ROOT / "frontend" / "src" / "App.jsx")

    assert "if (isCodingChatRoute) return true;" in source
    assert "setCodingWidgetSessionId(sessionId)" in source
    assert 'path="/chat/coding"' in app_source
    assert "activeSelectionRef.current" in app_source
    assert "activeSelectionRef.current = id;" in app_source
    assert "shouldPreserveSelection" in app_source
    assert "setActiveId(shouldPreserveSelection ? selectedId : freshId)" in app_source


def test_sidebar_history_navigation_leaves_workspace_before_session_swap():
    app_source = read(ROOT / "frontend" / "src" / "App.jsx")
    handle_select = app_source.split("const handleSelect = (id) => {", 1)[1]
    handle_select = handle_select.split("  // Header/brand click:", 1)[0]

    assert "workspace restore effects can pull the URL back" in handle_select
    assert "navigate(targetRoute);" in handle_select
    assert "window.setTimeout" in handle_select
    assert "activeSelectionRef.current === id" in handle_select
    assert handle_select.index("navigate(targetRoute);") < handle_select.index("setActiveId(id);")


def test_coding_widget_close_clears_transient_surfaces_without_navigation():
    source = read(CHATBOX)
    app_source = read(ROOT / "frontend" / "src" / "App.jsx")

    assert 'navigate: action.navigate ?? true' in source
    assert 'startFreshCodingWidgetSession({ type: "closed", title: "Coding Tutor", navigate: false })' in source
    assert "onSessionChange(messages, sessionId)" in source
    assert "if (config.navigate === false) return id;" in app_source
    assert "const handleUpdateSession = (msgs, sessionId = activeId)" in app_source
    assert "s.id === sessionId" in app_source


def test_floating_chat_previews_tutor_code_before_applying():
    source = read(FLOATING_CHAT)
    tutor_source = read(CODING_TUTOR)

    assert "Preview tutor suggestion" in source
    assert "floating-apply-preview" in source
    assert 'onApplyAICode("comment")' in source
    assert 'onApplyAICode("append")' in source
    assert 'onApplyAICode("replace")' in source
    assert "Replace the current workspace code with this tutor suggestion?" not in tutor_source
    assert "applyAiCodeWithMode" in tutor_source


def test_floating_chat_keeps_context_compact():
    source = read(FLOATING_CHAT)
    workspace_context = read(ROOT / "frontend" / "src" / "components" / "coding-tutor" / "WorkspaceCodeContext.jsx")

    assert "TutorStatusCard" not in source
    assert "<WorkspaceCodeContext" in source
    assert "attempts={attempts}" in source
    assert "<small>{attempts} attempts</small>" in workspace_context


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
