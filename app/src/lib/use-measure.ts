import { useEffect, useState } from "react";

/**
 * The live size of an element, so height can be animated to a number rather than to `auto`.
 *
 * CSS cannot interpolate `auto`. Motion will not invent the missing number either. A ResizeObserver
 * is the cheap way to know the value before the animation starts, and to keep it current when the
 * content changes — a name field appearing on create-account, an error line wrapping.
 */
export function useMeasure<T extends HTMLElement>({
  offsetSize = false,
}: {
  offsetSize?: boolean;
} = {}) {
  const [node, setNode] = useState<T | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!node) return;

    const update = () => {
      if (offsetSize) {
        setBounds({ width: node.offsetWidth, height: node.offsetHeight });
        return;
      }
      const { width, height } = node.getBoundingClientRect();
      setBounds({ width, height });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, offsetSize]);

  return [setNode, bounds] as const;
}
