import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeEditor from "./CodeEditor";
import HintPanel from "./HintPanel";
import RunControls from "./RunControls";
import TestOutput from "./TestOutput";

const WORKSPACE_TABS = ["Editor", "Output", "Hints", "Discussion"];

export default function CodeWorkspace({
  activeProblem,
  code,
  note,
  selectedLanguage,
  languageOptions,
  languageFormat,
  workspaceTab,
  hints,
  revealedHints,
  testOutput,
  latestFeedback,
  suggestedCodeBlock,
  onCodeChange,
  onNoteChange,
  onLanguageChange,
  onTabChange,
  onRun,
  onMarkSolved,
  onCopyCode,
  onApplyAICode,
  onShowHint,
  onShowAllHints,
  codeRenderer,
}) {
  const renderTab = () => {
    if (workspaceTab === "Output") return <TestOutput testOutput={testOutput} expanded />;
    if (workspaceTab === "Hints") {
      return (
        <HintPanel
          hints={hints}
          revealedHints={revealedHints}
          onShowHint={onShowHint}
          onShowAllHints={onShowAllHints}
          codeRenderer={codeRenderer}
        />
      );
    }
    if (workspaceTab === "Discussion") {
      return (
        <div className="workspace-discussion-panel">
          {latestFeedback ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: codeRenderer }}>
              {latestFeedback}
            </ReactMarkdown>
          ) : <p>Tutor replies will appear here after you ask for review, debugging, or edge cases.</p>}
        </div>
      );
    }
    return <CodeEditor code={code} note={note} onCodeChange={onCodeChange} onNoteChange={onNoteChange} />;
  };

  return (
    <main className="coding-editor-center">
      <div className="coding-pane-header">
        <div><span className="coding-kicker">Workspace</span><h2>{activeProblem?.title || "Code Editor"}</h2></div>
        <select className="coding-select" value={selectedLanguage} onChange={(event) => onLanguageChange(event.target.value)}>
          {languageOptions.map(language => <option key={language} value={language}>{language}</option>)}
        </select>
      </div>
      <div className="language-format-card">
        <span>{languageFormat.file}</span>
        <span>{languageFormat.style}</span>
        <span>{languageFormat.indent}</span>
      </div>
      <div className="workspace-tabs">
        {WORKSPACE_TABS.map(tab => (
          <button key={tab} type="button" className={workspaceTab === tab ? "active" : ""} onClick={() => onTabChange(tab)}>
            {tab}
          </button>
        ))}
      </div>
      <div className="workspace-tab-body">{renderTab()}</div>
      <RunControls
        code={code}
        activeProblem={activeProblem}
        suggestedCodeBlock={suggestedCodeBlock}
        onRun={onRun}
        onMarkSolved={onMarkSolved}
        onCopyCode={onCopyCode}
        onApplyAICode={onApplyAICode}
      />
    </main>
  );
}
