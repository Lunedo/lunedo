import { Module } from "@nestjs/common";
import { SavedSearchesController } from "./saved-searches.controller.js";
import { SearchController } from "./search.controller.js";

@Module({ controllers: [SearchController, SavedSearchesController] })
export class SearchModule {}
