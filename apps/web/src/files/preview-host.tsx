import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { FilePreviewDrawer } from "./file-preview.js";

interface PreviewHost {
  open: (attachmentId: string) => void;
}

const PreviewHostContext = createContext<PreviewHost | null>(null);

export function AttachmentPreviewProvider({ canEdit, children }: { canEdit: boolean; children: ReactNode }) {
  const [attachmentId, setAttachmentId] = useState<string | null>(null);
  const attachment = useQuery({
    queryKey: ["attachments", attachmentId],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/attachments/{attachmentId}", {
          params: { path: { attachmentId: attachmentId ?? "" } },
        }),
      ),
    enabled: attachmentId !== null,
    throwOnError: false,
  });
  const value = useMemo<PreviewHost>(() => ({ open: setAttachmentId }), []);
  return (
    <PreviewHostContext.Provider value={value}>
      {children}
      <FilePreviewDrawer
        open={attachmentId !== null}
        attachment={attachmentId && attachment.data?.id === attachmentId ? attachment.data : null}
        error={attachment.isError ? attachment.error : null}
        onRetry={() => void attachment.refetch()}
        canEdit={canEdit}
        onClose={() => setAttachmentId(null)}
      />
    </PreviewHostContext.Provider>
  );
}

export function useAttachmentPreview(): PreviewHost | null {
  return useContext(PreviewHostContext);
}
