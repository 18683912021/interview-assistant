/**
 * 脉冲圆点 —— 采集进行中的动画指示器
 */
export default function PulsingDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
    </span>
  );
}
