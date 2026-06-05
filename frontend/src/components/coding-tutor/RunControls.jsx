export default function RunControls({
  code,
  activeProblem,
  suggestedCodeBlock,
  onRun,
  onMarkSolved,
  onCopyCode,
  onApplyAICode,
}) {
  const hasCode = Boolean(code.trim());
  return (
    <div className="coding-action-grid workspace-actions">
      <button type="button" onClick={onRun} disabled={!hasCode}>Run</button>
      <button type="button" onClick={onMarkSolved} disabled={!activeProblem || activeProblem.source === "leetcode" || !hasCode}>Mark Solved</button>
      <button type="button" onClick={onCopyCode} disabled={!hasCode}>Copy Code</button>
      <button type="button" onClick={onApplyAICode} disabled={!suggestedCodeBlock}>Apply AI Code</button>
    </div>
  );
}
