/**
 * 麦克风电平条
 *
 * 使用 CSS transition 做平滑动画，替代 RN Animated
 */
interface Props {
  level: number; // 0-100
  className?: string;
}

export default function MicLevelBar({ level, className = '' }: Props) {
  const bars = 20;
  const activeBars = Math.min(Math.floor((level / 100) * bars), bars);

  return (
    <div className={`flex items-end gap-px h-6 ${className}`}>
      {Array.from({ length: bars }, (_, i) => {
        const isActive = i < activeBars;
        const height = isActive ? `${Math.max(15, (i / bars) * 100)}%` : '15%';
        const color = isActive
          ? level > 70
            ? 'bg-danger'
            : level > 40
              ? 'bg-accent'
              : 'bg-success'
          : 'bg-divider';

        return (
          <div
            key={i}
            className={`flex-1 rounded-full transition-all duration-100 ${color}`}
            style={{ height }}
          />
        );
      })}
    </div>
  );
}
