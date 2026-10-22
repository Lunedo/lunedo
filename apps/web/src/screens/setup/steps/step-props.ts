import type { SetupStepDetails, SetupStepId } from "@lunedo/shared";
import type { ReactNode } from "react";

export interface StepProps<S extends SetupStepId> {
  details: SetupStepDetails<S>;
  completed: boolean;
  back: ReactNode;
  onDone: () => Promise<void>;
  refresh: () => Promise<void>;
}
