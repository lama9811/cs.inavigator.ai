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
WORKSPACE_VISUALIZER = ROOT / "frontend" / "src" / "components" / "coding-tutor" / "WorkspaceVisualizer.jsx"
UNIVERSAL_VISUALIZER = ROOT / "frontend" / "src" / "components" / "coding-tutor" / "universal-visualizer" / "UniversalCodeVisualizer.tsx"
UNIVERSAL_STRUCTURE_VISUALIZERS = ROOT / "frontend" / "src" / "components" / "coding-tutor" / "universal-visualizer" / "StructureVisualizers.tsx"
UNIVERSAL_GENERATORS = ROOT / "frontend" / "src" / "components" / "coding-tutor" / "universal-visualizer" / "generators.ts"
UNIVERSAL_TYPES = ROOT / "frontend" / "src" / "components" / "coding-tutor" / "universal-visualizer" / "types.ts"
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


def test_third_hint_uses_pseudocode_not_reference_solution_prompt():
    tutor_source = read(CODING_TUTOR)
    pseudocode_function = tutor_source.split("function buildPseudocodeSnippet", 1)[1].split("function buildDetailedPseudocodeSnippet", 1)[0]
    hint_ladder = tutor_source.split("function buildHintSteps", 1)[1]
    third_hint = hint_ladder.split("level: 3", 1)[1].split("level: 4", 1)[0]
    fourth_hint = hint_ladder.split("level: 4", 1)[1].split("]", 1)[0]

    assert "Pseudocode shape:" in third_hint
    assert "Detailed pseudocode:" in fourth_hint
    assert "Before running again, test:" in fourth_hint
    assert "buildPseudocodeSnippet(problem)" in hint_ladder
    assert "buildDetailedPseudocodeSnippet(problem)" in hint_ladder
    assert "reference_solution" not in pseudocode_function
    assert "starter_code" not in pseudocode_function
    assert "functionName" not in pseudocode_function
    assert "buildShapeSnippet" not in tutor_source
    assert "shapeSnippet" not in third_hint
    assert "shapeSnippet" not in fourth_hint
    assert "Small Code Fragment" not in fourth_hint


def test_deep_hints_sanitize_ai_prompts_and_starter_shapes():
    tutor_source = read(CODING_TUTOR)
    sanitizer = tutor_source.split("function safeDeepHintText", 1)[1].split("function normalizeCodeForCompare", 1)[0]

    assert "ask\\s+(the\\s+)?ai" in sanitizer
    assert "prompt\\s+(the\\s+)?(ai|tutor)" in sanitizer
    assert "starter (function|workspace|code|signature)" in sanitizer
    assert "functionName && lower.includes(functionName)" in sanitizer
    assert "safeDeepHintText(hintAt(3), solution)" in tutor_source
    assert "safeDeepHintText(hintAt(4), solution)" in tutor_source


def test_pseudocode_templates_cover_major_practice_families():
    tutor_source = read(CODING_TUTOR)
    templates = tutor_source.split("const PSEUDOCODE_TEMPLATES = {", 1)[1].split("function templateForProblem", 1)[0]
    families = [
        "array",
        "string",
        "conditionals",
        "math",
        "map",
        "set",
        "stack",
        "queue",
        "two-pointers",
        "sliding-window",
        "binary-search",
        "recursion",
        "linked-list",
        "tree",
        "graph",
        "heap",
        "trie",
        "union-find",
        "dynamic-programming",
        "intervals",
        "prefix-sum",
        "matrix",
        "bit-manipulation",
    ]

    for family in families:
        assert f"{family}:" in templates or f'"{family}":' in templates
    assert "short:" in templates
    assert "detailed:" in templates
    assert "edges:" in templates
    assert "Ask: does this input match that rule?" in templates
    assert "List each condition from the prompt in priority order" not in templates


def test_workspace_visualizer_does_not_infer_topic_fallbacks():
    visualizer_source = read(WORKSPACE_VISUALIZER)
    utils_source = read(ROOT / "frontend" / "src" / "components" / "coding-tutor" / "workspaceVisualizerUtils.js")

    assert "function inferVisualizerFromProblem" not in visualizer_source
    assert "inferVisualizerFromProblem(activeProblem)" not in visualizer_source
    assert "hasAuthoredVisualizer(activeProblem)" in visualizer_source
    assert "problem?.visualizer?.concept" in utils_source


def test_decision_flow_visualizer_uses_real_branch_diagram():
    visualizer_source = read(WORKSPACE_VISUALIZER)
    visualizer_css = read(ROOT / "frontend" / "src" / "components" / "coding-tutor" / "WorkspaceVisualizer.css")

    assert "function decisionFlowTrace" in visualizer_source
    assert "function VisualDecisionFlow" in visualizer_source
    assert 'concept === "decision-flow") return decisionFlowTrace(meta)' in visualizer_source
    assert "activeDecision" in visualizer_source
    assert "decision-branches" in visualizer_source
    assert ".decision-condition" in visualizer_css
    assert ".decision-yes" in visualizer_css
    assert ".decision-no" in visualizer_css


def test_universal_visualizer_covers_major_topic_families():
    visualizer_source = read(UNIVERSAL_VISUALIZER)
    structure_source = read(UNIVERSAL_STRUCTURE_VISUALIZERS)
    generator_source = read(UNIVERSAL_GENERATORS)
    type_source = read(UNIVERSAL_TYPES)

    assert "interface Node" in type_source
    assert "interface Edge" in type_source
    assert "interface Step" in type_source
    assert "interface ConceptConfig" in type_source
    assert "motion.div" in structure_source
    assert "ReactFlow" in structure_source
    assert "MarkerType.ArrowClosed" in structure_source
    assert "AnimatePresence" in structure_source
    assert "Previous" in visualizer_source
    assert "Next" in visualizer_source
    assert "function StackVisualizer" in structure_source
    assert "function QueueVisualizer" in structure_source
    assert "function TreeVisualizer" in structure_source
    assert "function GraphVisualizer" in structure_source
    assert "function LinkedListVisualizer" in structure_source
    assert "function HashTableVisualizer" in structure_source
    assert "function DPTableVisualizer" in structure_source
    assert "function IntervalVisualizer" in structure_source
    assert "function ConditionalFlowVisualizer" in structure_source
    assert 'if (step.concept === "stack") return <StackVisualizer step={step} />;' in visualizer_source
    assert 'if (step.concept === "queue") return <QueueVisualizer step={step} />;' in visualizer_source
    assert 'if (step.concept === "hash-map") return <HashTableVisualizer step={step} />;' in visualizer_source
    assert 'if (step.concept === "graph" || step.concept === "union-find") return <GraphVisualizer step={step} />;' in visualizer_source
    assert "flex-direction: column-reverse" in read(ROOT / "frontend" / "src" / "components" / "coding-tutor" / "universal-visualizer" / "UniversalCodeVisualizer.css")
    assert "ucv-queue-track" in structure_source
    assert "dagre.layout(graph)" in structure_source
    assert "ucv-bucket-row" in structure_source
    assert "ucv-dp-grid" in structure_source
    assert "UniversalCodeVisualizer" in read(WORKSPACE_VISUALIZER)

    families = [
        "generateArraySwapSteps",
        "generateTupleSteps",
        "generateSetSteps",
        "generateHashMapCollisionSteps",
        "generateTreeInsertSteps",
        "generateGraphTraversalSteps",
        "generateConditionalSteps",
        "generateStackSteps",
        "generateQueueSteps",
        "generateLinkedListSteps",
        "generateBinarySearchSteps",
        "generateTwoPointerSteps",
        "generateSlidingWindowSteps",
        "generateRecursionSteps",
        "generateMatrixSteps",
        "generatePrefixSumSteps",
        "generateIntervalsSteps",
        "generateHeapSteps",
        "generateTrieSteps",
        "generateUnionFindSteps",
        "generateDynamicProgrammingSteps",
        "generateBitSteps",
        "generateMathSteps",
    ]

    for family in families:
        assert f"function {family}" in generator_source


def test_universal_visualizer_steps_have_workflow_rail():
    visualizer_source = read(UNIVERSAL_VISUALIZER)
    generator_source = read(UNIVERSAL_GENERATORS)
    type_source = read(UNIVERSAL_TYPES)

    assert "interface WorkflowStep" in type_source
    assert "workflow?: WorkflowStep[]" in type_source
    assert "activeWorkflowId?: string" in type_source
    assert "function WorkflowRail" in visualizer_source
    assert "ucv-workflow" in visualizer_source
    assert "<WorkflowRail step={step} />" in visualizer_source
    assert "const WORKFLOW_LABELS" in generator_source
    assert "function workflowForConcept" in generator_source
    assert "partial.workflow || workflowForConcept(partial.concept, index - 1)" in generator_source

    concepts = [
        "array",
        "tuple",
        "set",
        "linked-list",
        "hash-map",
        "binary-tree",
        "graph",
        "conditional",
        "stack",
        "queue",
        "two-pointers",
        "sliding-window",
        "binary-search",
        "recursion",
        "math",
        "matrix",
        "prefix-sum",
        "intervals",
        "heap",
        "trie",
        "union-find",
        "dynamic-programming",
        "bit-manipulation",
    ]
    for concept in concepts:
        assert f'{concept}:' in generator_source or f'"{concept}":' in generator_source


def test_universal_visualizer_prefers_question_examples_and_authored_steps():
    visualizer_source = read(UNIVERSAL_VISUALIZER)
    generator_source = read(UNIVERSAL_GENERATORS)

    assert "visualizer: problem?.visualizer" in visualizer_source
    assert "const useAuthored = concept === initialConcept" in visualizer_source
    assert "generateAuthoredVisualizerSteps(concept, context)" in generator_source
    assert "parseFirstList(context.exampleInput)" in generator_source
    assert "parseAllNamedLists(context.exampleInput)" in generator_source
    assert "context.exampleOutput" in generator_source
    assert "titleForAuthoredStep" in generator_source
    assert "bodyForAuthoredStep" in generator_source
    assert "authoredTupleVisual" in generator_source
    assert "authoredSetVisual" in generator_source
    assert "authoredUnionFindVisual" in generator_source
    assert "authoredPrefixSumVisual" in generator_source
    assert "authoredIntervalVisual" in generator_source
    assert 'if (topic.includes("set") || visualConcept === "set") return "set";' in visualizer_source
    assert 'if (raw.includes("union") || raw.includes("disjoint")) return "union-find";' in visualizer_source
    assert "layoutConditional" not in generator_source.split("function authoredConditionalVisual", 1)[1].split("function authoredStackQueueVisual", 1)[0]
    assert 'meta: { role: "diamond" }' in generator_source
    structure_source = read(UNIVERSAL_STRUCTURE_VISUALIZERS)
    assert 'label: "true"' in structure_source
    assert 'label: "false"' in structure_source


def test_workspace_state_syncs_last_problem_and_prefers_newer_drafts():
    main_source = read(MAIN_API)
    tutor_source = read(CODING_TUTOR)
    draft_source = read(WORKSPACE_DRAFT)

    assert '"/api/coding/workspace-state"' in main_source
    assert "CodingWorkspaceState" in main_source
    assert "saveWorkspaceState(problem.id, language, \"practice\")" in tutor_source
    assert "saveWorkspaceState(question.id, openedLanguageKey, \"interview\")" in tutor_source
    assert 'saveLastWorkspace(question.id, openedLanguageKey, "interview")' in tutor_source
    assert 'if (!opts.mock) {' in tutor_source
    assert 'if (activeProblem?.mock) {' in tutor_source
    assert 'setActiveProblem(null);' in tutor_source
    assert "loadWorkspaceState" in tutor_source
    assert "chooseWorkspaceCode" in tutor_source
    assert "Date.parse(serverProgress?.updated_at || \"\")" in tutor_source
    assert "export function readDraftEntry" in draft_source
    assert 'source === "interview" ? "interview" : "practice"' in draft_source
    assert 'startsWith("iv-") return null' not in draft_source


def test_coding_chat_history_preserves_widget_metadata():
    app_source = read(APP)

    assert 'String(sid).startsWith("coding-")' in app_source
    assert 'surface: "widget"' in app_source
    assert 'widgetSessionId: sid' in app_source
