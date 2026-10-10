import {Children, type ComponentPropsWithoutRef, type ReactNode} from 'react';
import * as Primitive from '@radix-ui/react-select';
import {Check, ChevronDown, ChevronUp} from 'lucide-react';

type Props = Omit<ComponentPropsWithoutRef<typeof Primitive.Trigger>, 'value' | 'onChange'> & {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
};

// Encoding every value preserves the meaningful empty choice (e.g. no resume)
// without colliding with Radix's empty placeholder value or an actual record ID.
const encode = (value: string | number) => `choice:${value}`;

export function Select({value, onValueChange, children, className = '', disabled, ...props}: Props) {
  return (
    <Primitive.Root value={encode(value)} onValueChange={value => onValueChange(value.slice(7))} disabled={disabled}>
      <Primitive.Trigger {...props} type="button" className={`select-trigger ${className}`}>
        <Primitive.Value />
        <Primitive.Icon className="select-chevron"><ChevronDown size={15} /></Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content className="select-menu" position="popper" sideOffset={6} align="start" collisionPadding={12}>
          <Primitive.ScrollUpButton className="select-scroll"><ChevronUp size={14} /></Primitive.ScrollUpButton>
          <Primitive.Viewport className="select-viewport">{children}</Primitive.Viewport>
          <Primitive.ScrollDownButton className="select-scroll"><ChevronDown size={14} /></Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

export function SelectOption({value, children, disabled = false, description}: {
  value?: string | number; children: ReactNode; disabled?: boolean; description?: string;
}) {
  const text = Children.toArray(children).join('');
  return (
    <Primitive.Item className="select-option" value={encode(value ?? text)} textValue={text} disabled={disabled}>
      <span className="select-option-copy">
        <Primitive.ItemText>{children}</Primitive.ItemText>
        {description && <small>{description}</small>}
      </span>
      <Primitive.ItemIndicator className="select-check"><Check size={14} /></Primitive.ItemIndicator>
    </Primitive.Item>
  );
}
