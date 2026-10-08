import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { type Attachment, attachmentKeys, uploadFile } from "./attachments-api.js";

export interface UploadItem {
  id: string;
  file: File;
  loaded: number;
  total: number;
  state: "uploading" | "failed" | "done";
  error: unknown;
  attachment: Attachment | null;
}

type DoneHandler = (attachment: Attachment, file: File) => void;

interface UploadsValue {
  pageId: string;
  items: UploadItem[];
  start: (files: readonly File[], onDone?: DoneHandler) => void;
  retry: (id: string) => void;
  cancel: (id: string) => void;
  dismiss: (id: string) => void;
}

const UploadsContext = createContext<UploadsValue | null>(null);

let counter = 0;

export function UploadsProvider({ pageId, children }: { pageId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const aborts = useRef(new Map<string, () => void>());
  const handlers = useRef(new Map<string, DoneHandler | undefined>());

  const update = useCallback((id: string, change: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);

  const run = useCallback(
    (id: string, file: File) => {
      update(id, { state: "uploading", loaded: 0, total: file.size, error: null });
      const handle = uploadFile(pageId, file, (loaded, total) => update(id, { loaded, total }));
      aborts.current.set(id, handle.abort);
      handle.promise.then(
        async (attachment) => {
          aborts.current.delete(id);
          update(id, { state: "done", attachment, loaded: file.size });
          handlers.current.get(id)?.(attachment, file);
          await queryClient.invalidateQueries({ queryKey: attachmentKeys.list(pageId) });
          await queryClient.invalidateQueries({ queryKey: attachmentKeys.versions(attachment.id) });
        },
        (error: unknown) => {
          aborts.current.delete(id);
          if (error instanceof DOMException && error.name === "AbortError") {
            setItems((current) => current.filter((item) => item.id !== id));
            return;
          }
          update(id, { state: "failed", error });
        },
      );
    },
    [pageId, queryClient, update],
  );

  const value = useMemo<UploadsValue>(
    () => ({
      pageId,
      items,
      start: (files, onDone) => {
        for (const file of files) {
          counter += 1;
          const id = `upload-${counter}`;
          handlers.current.set(id, onDone);
          setItems((current) => [
            ...current,
            { id, file, loaded: 0, total: file.size, state: "uploading", error: null, attachment: null },
          ]);
          run(id, file);
        }
      },
      retry: (id) => {
        const item = items.find((candidate) => candidate.id === id);
        if (item) run(id, item.file);
      },
      cancel: (id) => aborts.current.get(id)?.(),
      dismiss: (id) => {
        handlers.current.delete(id);
        setItems((current) => current.filter((item) => item.id !== id));
      },
    }),
    [items, pageId, run],
  );

  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploads(): UploadsValue | null {
  return useContext(UploadsContext);
}
