import { decision } from "./decision.js";
import { howTo } from "./how-to.js";
import { incidentPostmortem } from "./incident-postmortem.js";
import { meetingNotes } from "./meeting-notes.js";
import { onboardingChecklist } from "./onboarding-checklist.js";
import { oneOnOne } from "./one-on-one.js";
import { projectPlan } from "./project-plan.js";
import { requirements } from "./requirements.js";
import { retrospective } from "./retrospective.js";
import { teamHome } from "./team-home.js";
import { teamMeeting } from "./team-meeting.js";
import { troubleshooting } from "./troubleshooting.js";
import type { BuiltInTemplate } from "./types.js";

export const builtInTemplates: readonly BuiltInTemplate[] = [
  meetingNotes,
  decision,
  howTo,
  troubleshooting,
  projectPlan,
  retrospective,
  requirements,
  incidentPostmortem,
  onboardingChecklist,
  teamHome,
  teamMeeting,
  oneOnOne,
];
