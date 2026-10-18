import { createContext, type ReactNode, useContext } from "react";
import { contentUrl } from "./attachments-api.js";

export type AttachmentUrl = (attachmentId: string, version?: number) => string;

const defaultUrl: AttachmentUrl = (attachmentId, version) =>
  contentUrl(attachmentId, version === undefined ? {} : { version });

const AttachmentSource = createContext<AttachmentUrl>(defaultUrl);

export function AttachmentSourceProvider({ url, children }: { url: AttachmentUrl; children: ReactNode }) {
  return <AttachmentSource.Provider value={url}>{children}</AttachmentSource.Provider>;
}

export function useAttachmentUrl(): AttachmentUrl {
  return useContext(AttachmentSource);
}
