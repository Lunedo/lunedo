import {
  type SetupActionId,
  type SetupActionInput,
  type SetupActionResult,
  type SetupStepDetails,
  type SetupStepId,
  setupStepIds,
  setupStepSchemas,
} from "@lunedo/shared";
import { queryOptions } from "@tanstack/react-query";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";

export interface SetupStepState<S extends SetupStepId = SetupStepId> {
  id: S;
  required: boolean;
  completed: boolean;
  details: SetupStepDetails<S>;
}

export const setupStateQuery = queryOptions({
  queryKey: ["setup", "state"],
  queryFn: () => request(() => api.GET("/api/v1/setup"), { sessionHandling: false }),
});

export const setupStepsQuery = queryOptions({
  queryKey: ["setup", "steps"],
  queryFn: async () => {
    const result = await request(() => api.GET("/api/v1/setup/steps"), { sessionHandling: false });
    const steps = result.steps
      .filter((step): step is typeof step & { id: SetupStepId } =>
        setupStepIds.includes(step.id as SetupStepId),
      )
      .map((step) => ({
        id: step.id,
        required: step.required,
        completed: step.completed,
        details: setupStepSchemas[step.id].details.parse(step.details),
      })) as SetupStepState[];
    return { steps, ready: result.ready };
  },
});

export function stepDetails<S extends SetupStepId>(
  steps: readonly SetupStepState[],
  id: S,
): SetupStepDetails<S> | null {
  const step = steps.find((candidate) => candidate.id === id);
  return step ? (step.details as SetupStepDetails<S>) : null;
}

export async function runSetupAction<S extends SetupStepId, A extends SetupActionId<S>>(
  step: S,
  action: A,
  input: SetupActionInput<S, A>,
): Promise<SetupActionResult<S, A>> {
  const definition = (
    setupStepSchemas[step].actions as Record<string, { result: { parse(value: unknown): unknown } }>
  )[action];
  if (!definition) throw new Error(`Unknown setup action ${step}.${action}`);
  const body = await request(
    () =>
      api.POST("/api/v1/setup/steps/{step}/{action}", {
        params: { path: { step, action } },
        body: input as never,
        parseAs: step === "keyBackup" && action === "download" ? "text" : "json",
      }),
    { sessionHandling: false },
  );
  return definition.result.parse(body) as SetupActionResult<S, A>;
}
