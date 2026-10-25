import { useNavigate } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { AttachmentLightbox } from "./attachment-lightbox.js";

interface PreviewHost {
  open: (attachmentId: string, siblings?: readonly string[]) => void;
}

const PreviewHostContext = createContext<PreviewHost | null>(null);

interface Shown {
  ids: readonly string[];
  index: number;
}

export function AttachmentPreviewProvider({
  canEdit,
  requested,
  children,
}: {
  canEdit: boolean;
  requested?: string | undefined;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [shown, setShown] = useState<Shown | null>(requested ? { ids: [requested], index: 0 } : null);
  const close = () => {
    setShown(null);
    if (requested) {
      void navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({ ...previous, attachment: undefined }),
        replace: true,
      });
    }
  };
  const value = useMemo<PreviewHost>(
    () => ({
      open: (attachmentId, siblings = []) => {
        const ids = siblings.includes(attachmentId) ? [...siblings] : [attachmentId];
        setShown({ ids, index: ids.indexOf(attachmentId) });
      },
    }),
    [],
  );
  return (
    <PreviewHostContext.Provider value={value}>
      {children}
      {shown ? (
        <AttachmentLightbox
          ids={shown.ids}
          index={shown.index}
          canEdit={canEdit}
          onIndexChange={(index) => setShown((current) => (current ? { ...current, index } : current))}
          onClose={close}
        />
      ) : null}
    </PreviewHostContext.Provider>
  );
}

export function useAttachmentPreview(): PreviewHost | null {
  return useContext(PreviewHostContext);
}
