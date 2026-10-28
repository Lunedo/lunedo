import type { DateFormat } from "@lunedo/shared";
import type { z } from "zod";
import type { Executor } from "../database/database.js";
import type { Language, MailTemplate, MailTemplates } from "../mail/templates.js";

export interface VisibilityContext<P> {
  recipientId: string;
  organizationId: string | null;
  targetId: string | null;
  params: P;
  executor: Executor;
  can(action: string, resource: { type: string; id?: string }): Promise<boolean>;
}

export interface MailLocale {
  language: Language;
  timeZone: string;
  dateFormat: DateFormat;
}

export interface NotificationMail {
  template: MailTemplate;
  params: Omit<MailTemplates[MailTemplate], "instanceName">;
}

export interface NotificationSubject {
  spaceId: string | null;
  itemId: string | null;
}

export interface NotificationTypeDefinition<P = unknown> {
  type: string;
  targetType: string;
  params: z.ZodType<P>;
  subject?(context: { targetId: string | null; params: P; executor: Executor }): Promise<NotificationSubject>;
  visible(context: VisibilityContext<P>): Promise<boolean>;
  mail?(params: P, locale: MailLocale): NotificationMail;
  combineKey?(params: P): string | null;
}

export function defineNotificationType<P>(
  definition: NotificationTypeDefinition<P>,
): NotificationTypeDefinition<P> {
  return definition;
}

export class NotificationRegistry {
  readonly #types = new Map<string, NotificationTypeDefinition>();

  register(...definitions: NotificationTypeDefinition<unknown>[]): this {
    for (const definition of definitions) {
      if (this.#types.has(definition.type)) {
        throw new Error(`Notification type ${definition.type} is registered twice`);
      }
      this.#types.set(definition.type, definition);
    }
    return this;
  }

  get(type: string): NotificationTypeDefinition | undefined {
    return this.#types.get(type);
  }

  all(): NotificationTypeDefinition[] {
    return [...this.#types.values()];
  }
}
