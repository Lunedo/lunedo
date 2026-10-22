import {
  type EmbedService,
  embedFrameSources,
  type NodeJson,
  narrowEmbedServices,
  resolveEmbed,
} from "@lunedo/editor-schema";
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

  async forDocument(organizationId: string, document: unknown): Promise<EmbedService[]> {
    const urls: string[] = [];
    const visit = (node: NodeJson) => {
      if (node.type === "embed" && typeof node.attrs?.url === "string") urls.push(node.attrs.url);
      for (const child of node.content ?? []) visit(child);
    };
    visit(document as NodeJson);
    if (urls.length === 0) return [];
    const services = await this.organization(organizationId);
    return services.filter((service) => urls.some((url) => resolveEmbed(url, [service]) !== null));
  }

  async frameSources(): Promise<string[]> {
    return embedFrameSources(await this.instance());
  }
}
