/**
 * Avatar —— 首字母渐变头像（Linear 风格）
 *
 * 根据用户名首字母生成固定配色，无外部依赖。
 */
const COLORS = [
  'from-indigo-500 to-violet-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-blue-600',
  'from-fuchsia-500 to-purple-600',
];

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0]![0] || '?').toUpperCase();
  return ((parts[0]![0] || '') + (parts[parts.length - 1]![0] || '')).toUpperCase();
}

interface Props {
  name?: string | null;
  size?: number; // px, default 36
  className?: string;
}

export default function Avatar({ name, size = 36, className = '' }: Props) {
  const displayName = name || '用户';
  const gradient = hashColor(displayName);

  return (
    <div
      className={`bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-extrabold shadow-sm select-none ${className}`}
      style={{ width: size, height: size, borderRadius: size / 3, fontSize: size * 0.38 }}
      title={displayName}
    >
      {initials(displayName)}
    </div>
  );
}
