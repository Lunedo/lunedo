import {
  FileText,
  Folder,
  Link2,
  type LucideIcon,
  MessagesSquare,
  Newspaper,
  Presentation,
  Repeat,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  page: FileText,
  folder: Folder,
  link: Link2,
  blogPost: Newspaper,
  meetingSeries: Repeat,
  meetingTopic: MessagesSquare,
  whiteboard: Presentation,
};

export function itemIcon(kind: string | null | undefined): LucideIcon {
  return (kind ? ICONS[kind] : undefined) ?? FileText;
}
