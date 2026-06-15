export default function RunControls({
  code,
  activeProblem,
  suggestedCodeBlock,
  isRunning = false,
  onRun,
  onMarkSolved,
  onCopyCode,
  onApplyAICode,
}) {
  const hasCode = Boolean(code.trim());
  return (
    <div className="workspace-actions">
      <button type="button" className="workspace-action-primary" onClick={onRun} disabled={!hasCode || isRunning}>{isRunning ? "Running..." : "Run"}</button>
      <button type="button" className="workspace-action-success" onClick={onMarkSolved} disabled={!activeProblem || activeProblem.source === "leetcode" || !hasCode}>Mark Solved</button>
      <button type="button" className="workspace-action-secondary" onClick={onCopyCode} disabled={!hasCode}>Copy Code</button>
      <button type="button" className="workspace-action-secondary workspace-action-apply" onClick={onApplyAICode} disabled={!suggestedCodeBlock}>Apply AI Code</button>
    </div>
  );
}
