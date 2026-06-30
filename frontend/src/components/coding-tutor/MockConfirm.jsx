import { FaExclamationTriangle } from "react-icons/fa";

// Small confirm modal for one-way / consequential mock-interview actions
// (skipping a problem, viewing a solution mid-round). Styled to match the app
// rather than using window.confirm.
export default function MockConfirm({ open, title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "warn", onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="mock-confirm-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mock-confirm">
        <div className={`mock-confirm-icon tone-${tone}`} aria-hidden="true">
          <FaExclamationTriangle />
        </div>
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="mock-confirm-actions">
          <button type="button" className="mock-confirm-cancel" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={`mock-confirm-go tone-${tone}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
