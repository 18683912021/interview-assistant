/**
 * 弹窗组件 —— Portal + 遮罩 + ESC 关闭
 *
 * PC 端替代：Modal → ReactDOM.createPortal() + 遮罩
 */
// AppAlert: 内联弹窗组件，不需 Portal

interface Props {
  message: string;
  type?: 'info' | 'error' | 'success' | 'warning';
  title?: string;
  onDismiss?: () => void;
  confirmText?: string;
  onConfirm?: () => void;
}

export default function AppAlert({
  message,
  type = 'info',
  title,
  onDismiss,
  confirmText,
  onConfirm,
}: Props) {
  // 内联弹窗（无 Portal 后备）
  const colors = {
    info: { bg: 'bg-accent-light', text: 'text-accent', border: 'border-accent-soft' },
    error: { bg: 'bg-danger-light', text: 'text-danger', border: 'border-danger-light' },
    success: { bg: 'bg-success-light', text: 'text-success', border: 'border-success-light' },
    warning: { bg: 'bg-warning-light', text: 'text-warning', border: 'border-warning-light' },
  };

  const c = colors[type];

  return (
    <div className={`${c.bg} border ${c.border} rounded-md px-lg py-md mb-lg`}>
      {title && <div className={`text-body-sm font-semibold ${c.text} mb-xs`}>{title}</div>}
      <div className="text-body-sm text-text-primary">{message}</div>
      <div className="flex gap-sm mt-md">
        {onConfirm && confirmText && (
          <button
            onClick={onConfirm}
            className={`px-lg py-xs rounded-sm ${c.bg} ${c.text} text-body-sm font-medium hover:opacity-80 transition-opacity`}
          >
            {confirmText}
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="px-lg py-xs rounded-sm text-body-sm text-text-tertiary hover:text-text-secondary transition-colors"
          >
            关闭
          </button>
        )}
      </div>
    </div>
  );
}
