import { useEffect, useState } from "react";

export default function RunControls({
  code,
  activeProblem,
  suggestedCodeBlock,
  isRunning = false,
  canMarkSolved = true,
  onRun,
  onMarkSolved,
  onCopyCode,
  onApplyAICode,
  onClearWorkspace,
}) {
  const hasCode = Boolean(code.trim());
  const [confirmingClear, setConfirmingClear] = useState(false);
  const activeProblemId = activeProblem?.id || null;

  // Drop the confirm prompt whenever the loaded problem changes (including after
  // a successful clear), so it never lingers on the next problem.
  useEffect(() => {
    setConfirmingClear(false);
  }, [activeProblemId]);

  const canClear = hasCode || Boolean(activeProblem);

  const handleConfirmClear = () => {
    setConfirmingClear(false);
    onClearWorkspace?.();
  };

  return (
    <div className="workspace-actions">
      <button type="button" className="workspace-action-primary" onClick={onRun} disabled={!hasCode || isRunning}>{isRunning ? "Running..." : "Run"}</button>
      <button type="button" className="workspace-action-success" onClick={onMarkSolved} disabled={!canMarkSolved || !activeProblem || activeProblem.source === "leetcode" || !hasCode}>Mark Solved</button>
      <button type="button" className="workspace-action-secondary" onClick={onCopyCode} disabled={!hasCode}>Copy Code</button>
      {confirmingClear ? (
        <>
          <button type="button" className="workspace-action-secondary workspace-action-clear workspace-action-clear-confirm" onClick={handleConfirmClear} disabled={isRunning} title="This clears the editor. Your current problem is saved and can be reopened from Quiz Bank.">Confirm Clear</button>
          <button type="button" className="workspace-action-secondary" onClick={() => setConfirmingClear(false)} disabled={isRunning}>Cancel</button>
        </>
      ) : (
        <button type="button" className="workspace-action-secondary workspace-action-clear" onClick={() => setConfirmingClear(true)} disabled={isRunning || !canClear} title="Clear the editor and start a blank workspace">Clear Workspace</button>
      )}
      <button type="button" className="workspace-action-secondary workspace-action-apply" onClick={onApplyAICode} disabled={!suggestedCodeBlock}>Apply AI Code</button>
    </div>
  );
}
