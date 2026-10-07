import {
  doc,
  field,
  heading,
  type Inline,
  paragraph,
  placeholder,
  propertyTable,
  taskList,
} from "./nodes.js";
import type { BuiltInTemplate, BuiltInTemplateText } from "./types.js";

const en = {
  name: "Onboarding checklist",
  description: "Tasks for the first month of a new team member, from before day one onward.",
  title: "Onboarding {startDate}",
  newcomerLabel: "New team member",
  startDateLabel: "Start date",
  buddyLabel: "Buddy",
  welcome: (newcomer: Inline, buddy: Inline): Inline[] => [
    "Welcome, ",
    newcomer,
    "! This checklist guides you through your first weeks. ",
    buddy,
    " is your buddy and happy to help with any question.",
  ],
  manager: "Manager",
  managerHint: "@name",
  role: "Role",
  roleHint: "Job title and team",
  beforeDayOne: "Before day one",
  beforeDayOneTasks: [
    "Order the laptop and other equipment",
    "Create accounts for email, chat, this wiki and the ticket system",
    "Add the new team member to team meetings, channels and mailing lists",
    "Brief the buddy and block time for the first week",
    "Send a welcome message with the time and place for the first day",
  ],
  firstDay: "First day",
  firstDayTasks: [
    "Welcome and introduction to the team",
    "Set up the laptop and sign in to all tools",
    "Go through this checklist together with the buddy",
    "Have lunch or a coffee with the team",
  ],
  firstWeek: "First week",
  firstWeekTasks: [
    "Meet the most important contacts in one-to-one conversations",
    "Read the team home page and the key documentation",
    "Complete a first small task with the buddy",
    "Agree on goals for the first month with the manager",
  ],
  firstMonth: "First month",
  firstMonthTasks: [
    "Take on a task independently",
    "Complete the mandatory training, for example on security and data protection",
    "Have a feedback conversation with the manager",
    "Suggest improvements to this checklist",
  ],
  roleTasksHint: "Add tasks that are specific to this role.",
};

const de: typeof en = {
  name: "Onboarding-Checkliste",
  description: "Aufgaben für den ersten Monat neuer Teammitglieder, schon vor dem ersten Tag.",
  title: "Onboarding {startDate}",
  newcomerLabel: "Neues Teammitglied",
  startDateLabel: "Erster Arbeitstag",
  buddyLabel: "Buddy",
  welcome: (newcomer: Inline, buddy: Inline): Inline[] => [
    "Willkommen, ",
    newcomer,
    "! Diese Checkliste begleitet dich durch die ersten Wochen. Bei allen Fragen hilft dir ",
    buddy,
    " als Buddy gern weiter.",
  ],
  manager: "Führungskraft",
  managerHint: "@Name",
  role: "Rolle",
  roleHint: "Stellenbezeichnung und Team",
  beforeDayOne: "Vor dem ersten Tag",
  beforeDayOneTasks: [
    "Laptop und weitere Ausstattung bestellen",
    "Zugänge für E-Mail, Chat, dieses Wiki und das Ticketsystem anlegen",
    "Neues Teammitglied zu Teamterminen, Kanälen und Verteilern hinzufügen",
    "Buddy informieren und Zeit in der ersten Woche einplanen",
    "Willkommensnachricht mit Uhrzeit und Ort für den ersten Tag schicken",
  ],
  firstDay: "Erster Tag",
  firstDayTasks: [
    "Begrüßung und Vorstellung im Team",
    "Laptop einrichten und bei allen Werkzeugen anmelden",
    "Diese Checkliste gemeinsam mit dem Buddy durchgehen",
    "Mittagessen oder Kaffee mit dem Team",
  ],
  firstWeek: "Erste Woche",
  firstWeekTasks: [
    "Wichtigste Ansprechpersonen in Einzelgesprächen kennenlernen",
    "Startseite des Teams und die wichtigste Dokumentation lesen",
    "Erste kleine Aufgabe gemeinsam mit dem Buddy erledigen",
    "Ziele für den ersten Monat mit der Führungskraft vereinbaren",
  ],
  firstMonth: "Erster Monat",
  firstMonthTasks: [
    "Eine Aufgabe selbstständig übernehmen",
    "Pflichtschulungen abschließen, etwa zu Sicherheit und Datenschutz",
    "Feedbackgespräch mit der Führungskraft führen",
    "Verbesserungen für diese Checkliste vorschlagen",
  ],
  roleTasksHint: "Ergänze Aufgaben, die speziell für diese Rolle gelten.",
};

function text(t: typeof en): BuiltInTemplateText {
  const checklist = (tasks: string[]) => taskList(...tasks, placeholder(t.roleTasksHint));
  return {
    name: t.name,
    description: t.description,
    title: t.title,
    fields: [
      { key: "newcomer", label: t.newcomerLabel, type: "person", required: true },
      { key: "startDate", label: t.startDateLabel, type: "date", required: true },
      { key: "buddy", label: t.buddyLabel, type: "person", required: true },
    ],
    document: doc(
      paragraph(...t.welcome(field("newcomer"), field("buddy"))),
      propertyTable(
        [t.newcomerLabel, field("newcomer")],
        [t.role, placeholder(t.roleHint)],
        [t.startDateLabel, field("startDate")],
        [t.buddyLabel, field("buddy")],
        [t.manager, placeholder(t.managerHint)],
      ),
      heading(2, t.beforeDayOne),
      checklist(t.beforeDayOneTasks),
      heading(2, t.firstDay),
      checklist(t.firstDayTasks),
      heading(2, t.firstWeek),
      checklist(t.firstWeekTasks),
      heading(2, t.firstMonth),
      checklist(t.firstMonthTasks),
    ),
  };
}

export const onboardingChecklist: BuiltInTemplate = {
  key: "onboarding-checklist",
  category: "teams",
  text: { en: text(en), de: text(de) },
};
