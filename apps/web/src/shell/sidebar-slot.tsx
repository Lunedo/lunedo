import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface SidebarSlots {
  middle: HTMLElement | null;
  bottom: HTMLElement | null;
  claimed: boolean;
  claim: () => () => void;
  setMiddle: (element: HTMLElement | null) => void;
  setBottom: (element: HTMLElement | null) => void;
}

const SidebarSlotContext = createContext<SidebarSlots | null>(null);

export const SidebarSlotProvider = SidebarSlotContext;

export function useSidebarSlotState(): SidebarSlots {
  const [middle, setMiddle] = useState<HTMLElement | null>(null);
  const [bottom, setBottom] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((count) => count + 1);
    return () => setClaims((count) => count - 1);
  }, []);
  return useMemo(
    () => ({ middle, bottom, claimed: claims > 0, claim, setMiddle, setBottom }),
    [middle, bottom, claims, claim],
  );
}

export function useSidebarSlots(): SidebarSlots {
  const slots = useContext(SidebarSlotContext);
  if (!slots) throw new Error("useSidebarSlots needs the app shell");
  return slots;
}

export function SidebarContent({ middle, bottom }: { middle: ReactNode; bottom: ReactNode }) {
  const slots = useContext(SidebarSlotContext);
  const claim = slots?.claim;
  useLayoutEffect(() => claim?.(), [claim]);
  if (!slots) return null;
  return (
    <>
      {slots.middle ? createPortal(middle, slots.middle) : null}
      {slots.bottom ? createPortal(bottom, slots.bottom) : null}
    </>
  );
}
