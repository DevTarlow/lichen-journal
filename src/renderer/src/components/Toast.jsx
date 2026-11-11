import React, { useEffect } from 'react';
import { AlertIcon, CheckIcon, InfoIcon, XIcon } from './Icons.jsx';

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    const timer = window.setTimeout(
      () => onDismiss(toast.id),
      toast.type === 'error' ? 8000 : 4200
    );
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.type, onDismiss]);

  const Icon = toast.type === 'error' ? AlertIcon : toast.type === 'success' ? CheckIcon : InfoIcon;

  return (
    <div
      className={`toast toast-${toast.type}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
    >
      <span className="toast-icon">
        <Icon size={16} />
      </span>
      <div className="toast-copy">
        <p>{toast.message}</p>
        {toast.detail ? <span className="toast-detail">{toast.detail}</span> : null}
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        <XIcon size={13} />
      </button>
    </div>
  );
}

export default function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
