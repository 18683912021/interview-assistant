/**
 * 分割线组件
 */
interface Props {
  label?: string;
}

export default function SeparatorLine({ label }: Props) {
  if (!label) {
    return <div className="w-full border-t border-divider my-md" />;
  }

  return (
    <div className="flex items-center gap-md my-lg">
      <div className="flex-1 border-t border-divider" />
      <span className="text-caption text-text-tertiary">{label}</span>
      <div className="flex-1 border-t border-divider" />
    </div>
  );
}
