import type { SetupStepDetails, SetupStepId } from "@pagehall/shared";
import type { ReactNode } from "react";

export interface StepProps<S extends SetupStepId> {
  details: SetupStepDetails<S>;
  back: ReactNode;
  onDone: () => Promise<void>;
  refresh: () => Promise<void>;
}
