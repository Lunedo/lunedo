import { useLayoutEffect, useRef } from "react";

export function useReturnFocus(open: boolean): (event: Event) => void {
  const previous = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      previous.current = document.activeElement;
    }
  }, [open]);
  return (event) => {
    const target = previous.current;
    previous.current = null;
    if (target?.isConnected) {
      event.preventDefault();
      target.focus();
    }
  };
}
