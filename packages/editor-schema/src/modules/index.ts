import { ModuleRegistry } from "../module.js";
import { codeBlockModule } from "./code.js";
import { coreModule } from "./core.js";
import { drawingModule } from "./drawings.js";
import { excerptModule, includeModule } from "./includes.js";
import { contentByLabelModule, relatedLabelsModule } from "./labels.js";
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
import { pagePropertiesModule, propertiesReportModule } from "./properties.js";
import { dateModule, emojiModule, mentionModule, pageLinkModule } from "./references.js";
import { decisionReportModule, pageReportModule, taskReportModule } from "./reports.js";
import { roadmapModule } from "./roadmap.js";
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
  contentByLabelModule,
  coreModule,
  dateModule,
  decisionModule,
  decisionReportModule,
  drawingModule,
  emojiModule,
  excerptModule,
  expandModule,
  fileModule,
  formattingModule,
  imageModule,
  includeModule,
  inlineCommentModule,
  linkModule,
  listsModule,
  mathModule,
  mentionModule,
  pageLinkModule,
  pagePropertiesModule,
  pageReportModule,
  propertiesReportModule,
  relatedLabelsModule,
  roadmapModule,
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
  propertiesReportModule,
  contentByLabelModule,
  relatedLabelsModule,
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
  attachmentListModule,
  childPagesModule,
  pagePropertiesModule,
  excerptModule,
  includeModule,
  roadmapModule,
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
