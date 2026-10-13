import {useEffect, useState, type ReactNode, type ReactElement} from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

/** DOM-only tooltip: native title tooltips are separate OS surfaces and may leak into screen sharing. */
export function WindowTooltip({label, children}: {label?: ReactNode; children: ReactElement}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener('blur', close);
    document.addEventListener('visibilitychange', close);
    return () => {window.removeEventListener('blur', close); document.removeEventListener('visibilitychange', close);};
  }, []);
  return <Tooltip.Provider delayDuration={400}>
    <Tooltip.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      {label && <Tooltip.Portal><Tooltip.Content className="control-tooltip" sideOffset={6} collisionPadding={10}>
        {label}<Tooltip.Arrow className="tooltip-arrow" />
      </Tooltip.Content></Tooltip.Portal>}
    </Tooltip.Root>
  </Tooltip.Provider>;
}
