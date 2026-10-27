import type { Executor } from "../database/database.js";
import type { MembershipKind } from "../organizations/access-schema.js";
import type { SpaceRole } from "../spaces/schema.js";
import type { AccessLevel, Area } from "./areas.js";
import type { OrganizationFacts, SpaceFacts } from "./facts.js";

export interface Resource {
  type: string;
  id?: string;
}

export interface ActionDefinition {
  scope: "instance" | "organization" | "space";
  spaceRole?: SpaceRole;
  tokenScope?: { area: Area; level: AccessLevel; unrestrictedContent?: true };
  area?: Area;
  level?: AccessLevel;
  membership?: readonly MembershipKind[];
  breakGlass?: boolean;
  ownerOnly?: boolean;
  rule?: string;
  ruleRequired?: boolean;
  restriction?: string;
}

export interface RuleContext {
  accountId: string;
  resource: Resource;
  organizationId: string | null;
  executor: Executor;
  organizationFacts(organizationId: string): Promise<OrganizationFacts>;
  spaceFacts(spaceId: string): Promise<SpaceFacts>;
}

export type Rule = (context: RuleContext) => Promise<boolean>;

export const restrictionDenials = [
  "inTrash",
  "archived",
  "unpublished",
  "restricted",
  "editRestricted",
  "notResponsible",
  "exportDisabled",
] as const;

export type RestrictionDenial = (typeof restrictionDenials)[number];

export interface RestrictionResult {
  denial: RestrictionDenial;
  unless?: SpaceRole;
}

export type Restriction = (
  executor: Executor,
  ids: readonly string[],
) => Promise<Map<string, RestrictionResult>>;

export type Lookup = (executor: Executor, ids: readonly string[]) => Promise<Map<string, string>>;

export interface ResourceType {
  type: string;
  actions: Record<string, ActionDefinition>;
  organizationOf?: (executor: Executor, id: string) => Promise<string | null>;
  spaceOf?: Lookup;
  itemOf?: Lookup;
  rules?: Record<string, Rule>;
  restrictions?: Record<string, Restriction>;
}

export interface RegisteredAction extends ActionDefinition {
  name: string;
  resourceType: ResourceType;
}

export class AuthorizationRegistry {
  readonly #types = new Map<string, ResourceType>();
  readonly #actions = new Map<string, RegisteredAction>();

  register(...types: ResourceType[]): this {
    for (const type of types) {
      if (this.#types.has(type.type)) throw new Error(`Resource type ${type.type} is registered twice`);
      if (
        Object.values(type.actions).some((action) => action.scope === "organization") &&
        type.type !== "organization" &&
        !type.organizationOf
      ) {
        throw new Error(`Resource type ${type.type} has organization actions but no organization`);
      }
      if (Object.values(type.actions).some((action) => action.scope === "space") && !type.spaceOf) {
        throw new Error(`Resource type ${type.type} has space actions but no space`);
      }
      for (const [name, action] of Object.entries(type.actions)) {
        if ((action.scope === "space") !== (action.spaceRole !== undefined)) {
          throw new Error(`Action ${name} needs a space role exactly when it is a space action`);
        }
        if (!name.startsWith(`${type.type}.`))
          throw new Error(`Action ${name} must start with ${type.type}.`);
        if (this.#actions.has(name)) throw new Error(`Action ${name} is registered twice`);
        if (action.rule && !type.rules?.[action.rule])
          throw new Error(`Action ${name} uses the unknown rule ${action.rule}`);
        if (action.restriction && !type.restrictions?.[action.restriction])
          throw new Error(`Action ${name} uses the unknown restriction ${action.restriction}`);
        if (action.ruleRequired && (!action.rule || action.scope !== "space"))
          throw new Error(`Action ${name} can only require a rule as a space action with a rule`);
        if (action.restriction && action.scope !== "space")
          throw new Error(`Action ${name} can only have a restriction as a space action`);
        if ((action.area === undefined) !== (action.level === undefined)) {
          throw new Error(`Action ${name} needs both an area and a level`);
        }
        this.#actions.set(name, { ...action, name, resourceType: type });
      }
      this.#types.set(type.type, type);
    }
    return this;
  }

  action(name: string): RegisteredAction {
    const action = this.#actions.get(name);
    if (!action) throw new Error(`Unknown action ${name}`);
    return action;
  }

  actions(): RegisteredAction[] {
    return [...this.#actions.values()];
  }
}
