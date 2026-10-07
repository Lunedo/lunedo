import { ModuleRegistry } from "../module.js";
import { codeBlockModule } from "./code.js";
import { coreModule } from "./core.js";
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
import { dateModule, emojiModule, mentionModule, pageLinkModule } from "./references.js";
import { fileModule, imageModule, sectionModule } from "./structure.js";
import { tableModule } from "./table.js";

export {
  calloutModule,
  codeBlockModule,
  colorsModule,
  columnsModule,
  coreModule,
  dateModule,
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
  sectionModule,
  statusModule,
  tableModule,
  tableOfContentsModule,
  tasksModule,
  unsupportedMacroModule,
};

export const defaultModules = [
  coreModule,
  linkModule,
  formattingModule,
  colorsModule,
  inlineCommentModule,
  listsModule,
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
  calloutModule,
  expandModule,
  statusModule,
  tableOfContentsModule,
  columnsModule,
  mathModule,
  unsupportedMacroModule,
] as const;

export function createDefaultRegistry(): ModuleRegistry {
  return new ModuleRegistry().register(...defaultModules);
}
