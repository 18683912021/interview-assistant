/**
 * 次级页面（从右侧滑入的详情面板）
 */
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function SecondaryPage({ visible, title, onClose, children }: Props) {
  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* 遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-backdrop z-40"
            onClick={onClose}
          />

          {/* 面板 */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 w-96 bg-bg-surface shadow-lg z-50 flex flex-col"
          >
            <div className="flex items-center justify-between p-lg border-b border-divider">
              <h3 className="text-body font-semibold">{title}</h3>
              <button
                onClick={onClose}
                className="p-xs rounded-sm hover:bg-bg text-text-tertiary hover:text-text-primary transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-lg">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
