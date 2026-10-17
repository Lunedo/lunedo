import { ModuleRegistry } from "../module.js";
import { codeBlockModule } from "./code.js";
import { coreModule } from "./core.js";
import { diagramsModule } from "./diagrams.js";
import { drawingModule } from "./drawings.js";
import { embedModule } from "./embeds.js";
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
import { tabsModule } from "./tabs.js";
import { templateButtonModule, templatesModule } from "./templates.js";
import { thirdPartyMacrosModule } from "./thirdparty.js";
import { whiteboardModule } from "./whiteboards.js";

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
  diagramsModule,
  drawingModule,
  embedModule,
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
  tabsModule,
  taskReportModule,
  tasksModule,
  templateButtonModule,
  templatesModule,
  thirdPartyMacrosModule,
  topicUpdateModule,
  unsupportedMacroModule,
  whiteboardModule,
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
  diagramsModule,
  embedModule,
  whiteboardModule,
  attachmentListModule,
  childPagesModule,
  pagePropertiesModule,
  excerptModule,
  includeModule,
  roadmapModule,
  calloutModule,
  expandModule,
  tabsModule,
  statusModule,
  tableOfContentsModule,
  columnsModule,
  mathModule,
  templatesModule,
  templateButtonModule,
  topicUpdateModule,
  decisionModule,
  thirdPartyMacrosModule,
  unsupportedMacroModule,
] as const;

export function createDefaultRegistry(): ModuleRegistry {
  return new ModuleRegistry().register(...defaultModules);
}
