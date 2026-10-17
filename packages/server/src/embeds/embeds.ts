import { type EmbedService, embedFrameSources, narrowEmbedServices } from "@pagehall/editor-schema";
import type { SettingsService } from "../settings/service.js";
import { allowedEmbedServicesSetting, embedServicesSetting } from "./settings.js";

export class EmbedServices {
  readonly #settings: SettingsService;

  constructor(options: { settings: SettingsService }) {
    this.#settings = options.settings;
  }

  instance(): Promise<EmbedService[]> {
    return this.#settings.get(embedServicesSetting, {});
  }

  async organization(organizationId: string): Promise<EmbedService[]> {
    const [services, allowed] = await Promise.all([
      this.instance(),
      this.#settings.get(allowedEmbedServicesSetting, { organization: organizationId }),
    ]);
    return narrowEmbedServices(services, allowed);
  }

  async overview(
    organizationId: string,
  ): Promise<{ services: EmbedService[]; available: EmbedService[]; narrowed: boolean }> {
    const [available, allowed] = await Promise.all([
      this.instance(),
      this.#settings.get(allowedEmbedServicesSetting, { organization: organizationId }),
    ]);
    return { services: narrowEmbedServices(available, allowed), available, narrowed: allowed !== null };
  }

  async frameSources(): Promise<string[]> {
    return embedFrameSources(await this.instance());
  }
}
