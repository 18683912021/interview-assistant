import {useEffect, useState, type RefObject} from 'react';
import {ArrowUp} from 'lucide-react';

export function ScrollToTop({target, contentKey}: {target: RefObject<HTMLDivElement | null>; contentKey?: string | null}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = target.current;
    const update = () => setVisible(!!element && element.scrollTop > 320);
    update();
    element?.addEventListener('scroll', update, {passive: true});
    return () => element?.removeEventListener('scroll', update);
  }, [target, contentKey]);
  if (!visible) return null;
  return <button type="button" className="link-button back-to-top" onClick={() => target.current?.scrollTo({top: 0})}>
    <ArrowUp size={12} />回到开头
  </button>;
}
