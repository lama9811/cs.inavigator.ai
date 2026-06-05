const QUICK_ACTIONS = ["Hint", "Debug", "Review", "Complexity", "Edge Cases", "Rewrite"];

export default function TutorQuickActions({ isLoading, onQuickAction }) {
  return (
    <div className="ai-quick-actions compact tutor-quick-actions">
      {QUICK_ACTIONS.map(action => (
        <button key={action} type="button" className="tutor-action-button" onClick={() => onQuickAction(action)} disabled={isLoading}>
          {action}
        </button>
      ))}
    </div>
  );
}
