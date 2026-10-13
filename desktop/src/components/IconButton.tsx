import {type ComponentPropsWithoutRef} from 'react';
import {WindowTooltip} from './WindowTooltip';

export function IconButton({title, children, ...props}: ComponentPropsWithoutRef<'button'>) {
  return <WindowTooltip label={title || props['aria-label']}>
    <button type="button" {...props} aria-label={props['aria-label'] || title}>{children}</button>
  </WindowTooltip>;
}
