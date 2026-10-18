import { createContext, type ReactNode, useContext } from "react";
import { contentUrl, type ImageSize } from "./attachments-api.js";

export type AttachmentUrl = (attachmentId: string, version?: number, size?: ImageSize) => string;

const defaultUrl: AttachmentUrl = (attachmentId, version, size) =>
  contentUrl(attachmentId, { ...(version === undefined ? {} : { version }), ...(size ? { size } : {}) });

const AttachmentSource = createContext<AttachmentUrl>(defaultUrl);

export function AttachmentSourceProvider({ url, children }: { url: AttachmentUrl; children: ReactNode }) {
  return <AttachmentSource.Provider value={url}>{children}</AttachmentSource.Provider>;
}

export function useAttachmentUrl(): AttachmentUrl {
  return useContext(AttachmentSource);
}
