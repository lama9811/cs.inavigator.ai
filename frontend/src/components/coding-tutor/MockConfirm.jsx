import { FaExclamationTriangle } from "react-icons/fa";
import useFocusTrap from "./useFocusTrap";

// Small confirm modal for one-way / consequential mock-interview actions
// (skipping a problem, viewing a solution mid-round). Styled to match the app
// rather than using window.confirm.
export default function MockConfirm({ open, title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "warn", onConfirm, onCancel }) {
  const modalRef = useFocusTrap(open, { onEscape: onCancel });

  if (!open) return null;
  return (
    <div className="mock-confirm-overlay" role="presentation">
      <div
        ref={modalRef}
        className="mock-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mock-confirm-title"
        aria-describedby="mock-confirm-description"
        tabIndex={-1}
      >
        <div className={`mock-confirm-icon tone-${tone}`} aria-hidden="true">
          <FaExclamationTriangle />
        </div>
        <h3 id="mock-confirm-title">{title}</h3>
        <p id="mock-confirm-description">{body}</p>
        <div className="mock-confirm-actions">
          <button type="button" className="mock-confirm-cancel" onClick={onCancel} data-autofocus>{cancelLabel}</button>
          <button type="button" className={`mock-confirm-go tone-${tone}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
