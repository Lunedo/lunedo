import { ModuleRegistry } from "../module.js";
import { codeBlockModule } from "./code.js";
import { coreModule } from "./core.js";
import { diagramsModule } from "./diagrams.js";
import { drawingModule } from "./drawings.js";
import { attachmentListModule, childPagesModule } from "./listings.js";
import { listsModule, tasksModule } from "./lists.js";
import {
  calloutModule,
  columnsModule,
  expandModule,
  mathModule,
  statusModule,
  tableOfContentsModule,
  unsupportedMacroModule,
} from "./macros.js";
import { colorsModule, formattingModule, inlineCommentModule, linkModule } from "./marks.js";
import { decisionModule, topicUpdateModule } from "./meetings.js";
import { dateModule, emojiModule, mentionModule, pageLinkModule } from "./references.js";
import { decisionReportModule, pageReportModule, taskReportModule } from "./reports.js";
import { fileModule, imageModule, sectionModule } from "./structure.js";
import { tableModule } from "./table.js";
import { templateButtonModule, templatesModule } from "./templates.js";

export {
  attachmentListModule,
  calloutModule,
  childPagesModule,
  codeBlockModule,
  colorsModule,
  columnsModule,
  coreModule,
  dateModule,
  decisionModule,
  decisionReportModule,
  diagramsModule,
  drawingModule,
  emojiModule,
  expandModule,
  fileModule,
  formattingModule,
  imageModule,
  inlineCommentModule,
  linkModule,
  listsModule,
  mathModule,
  mentionModule,
  pageLinkModule,
  pageReportModule,
  sectionModule,
  statusModule,
  tableModule,
  tableOfContentsModule,
  taskReportModule,
  tasksModule,
  templateButtonModule,
  templatesModule,
  topicUpdateModule,
  unsupportedMacroModule,
};

export const defaultModules = [
  coreModule,
  linkModule,
  formattingModule,
  colorsModule,
  inlineCommentModule,
  listsModule,
  taskReportModule,
  pageReportModule,
  decisionReportModule,
  tasksModule,
  codeBlockModule,
  tableModule,
  mentionModule,
  pageLinkModule,
  emojiModule,
  dateModule,
  sectionModule,
  imageModule,
  fileModule,
  drawingModule,
  diagramsModule,
  attachmentListModule,
  childPagesModule,
  calloutModule,
  expandModule,
  statusModule,
  tableOfContentsModule,
  columnsModule,
  mathModule,
  templatesModule,
  templateButtonModule,
  topicUpdateModule,
  decisionModule,
  unsupportedMacroModule,
] as const;

export function createDefaultRegistry(): ModuleRegistry {
  return new ModuleRegistry().register(...defaultModules);
}
