import {type ComponentPropsWithoutRef} from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

export function IconButton({title, children, ...props}: ComponentPropsWithoutRef<'button'>) {
  const label = title || props['aria-label'];
  return (
    <Tooltip.Provider delayDuration={400}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild><button type="button" {...props} aria-label={props['aria-label'] || title}>{children}</button></Tooltip.Trigger>
        {label && <Tooltip.Portal><Tooltip.Content className="control-tooltip" sideOffset={6} collisionPadding={10}>
          {label}<Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content></Tooltip.Portal>}
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
