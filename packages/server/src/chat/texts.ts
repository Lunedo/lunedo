import type { ChatEvent } from "@pagehall/shared";
import type { Language } from "../mail/templates.js";

export interface ChatTextInput {
  spaceName: string;
  organizationName: string;
  actors: string[];
  count: number;
  status: { builtIn: string | null; name: string | null } | null;
  channelName: string;
}

export interface ChatTexts {
  heading: string;
  detail: string | null;
  linkLabel: string;
}

const STATUS: Record<Language, Record<string, string>> = {
  en: {
    roughDraft: "Rough draft",
    inProgress: "In progress",
    readyForReview: "Ready for review",
    verified: "Verified",
  },
  de: {
    roughDraft: "Rohentwurf",
    inProgress: "In Arbeit",
    readyForReview: "Bereit zur Prüfung",
    verified: "Geprüft",
  },
};

function people(actors: readonly string[], language: Language): string | null {
  const [first, ...rest] = actors;
  if (!first) return null;
  if (rest.length === 0) return first;
  if (language === "de")
    return `${first} und ${rest.length} ${rest.length === 1 ? "weitere Person" : "weitere Personen"}`;
  return `${first} and ${rest.length} ${rest.length === 1 ? "other" : "others"}`;
}

function statusName(input: ChatTextInput, language: Language): string | null {
  if (!input.status) return null;
  if (input.status.builtIn) return STATUS[language][input.status.builtIn] ?? input.status.builtIn;
  return input.status.name;
}

function english(event: ChatEvent | "test", input: ChatTextInput): Omit<ChatTexts, "linkLabel"> {
  const by = people(input.actors, "en");
  switch (event) {
    case "pagePublished":
      return { heading: `New page in ${input.spaceName}`, detail: by ? `Published by ${by}` : null };
    case "pageChanged":
      return {
        heading: `Page changed in ${input.spaceName}`,
        detail: by
          ? `Changed by ${by}${input.count > 1 ? `, ${input.count} times in the last hour` : ""}`
          : input.count > 1
            ? `Changed ${input.count} times in the last hour`
            : null,
      };
    case "blogPostPublished":
      return { heading: `New blog post in ${input.spaceName}`, detail: by ? `By ${by}` : null };
    case "decisionRecorded":
      return { heading: `Decision recorded in ${input.spaceName}`, detail: null };
    case "pageStatusChanged": {
      const status = statusName(input, "en");
      return {
        heading: `Page status changed in ${input.spaceName}`,
        detail: status
          ? `${by ?? "Someone"} set the status to ${status}`
          : `${by ?? "Someone"} removed the status`,
      };
    }
    case "commentCreated":
      return { heading: `New comment in ${input.spaceName}`, detail: `${by ?? "Someone"} commented` };
    case "announcementPublished":
      return { heading: `Announcement from ${input.organizationName}`, detail: null };
    case "test":
      return {
        heading: "Test message from Pagehall",
        detail: `This channel is connected as “${input.channelName}”. Messages you chose will appear here.`,
      };
  }
}

function german(event: ChatEvent | "test", input: ChatTextInput): Omit<ChatTexts, "linkLabel"> {
  const by = people(input.actors, "de");
  switch (event) {
    case "pagePublished":
      return { heading: `Neue Seite in ${input.spaceName}`, detail: by ? `Veröffentlicht von ${by}` : null };
    case "pageChanged":
      return {
        heading: `Seite geändert in ${input.spaceName}`,
        detail: by
          ? `Geändert von ${by}${input.count > 1 ? `, ${input.count}-mal in der letzten Stunde` : ""}`
          : input.count > 1
            ? `${input.count}-mal geändert in der letzten Stunde`
            : null,
      };
    case "blogPostPublished":
      return { heading: `Neuer Blogbeitrag in ${input.spaceName}`, detail: by ? `Von ${by}` : null };
    case "decisionRecorded":
      return { heading: `Entscheidung festgehalten in ${input.spaceName}`, detail: null };
    case "pageStatusChanged": {
      const status = statusName(input, "de");
      return {
        heading: `Seitenstatus geändert in ${input.spaceName}`,
        detail: status
          ? `${by ?? "Jemand"} hat den Status auf ${status} gesetzt`
          : `${by ?? "Jemand"} hat den Status entfernt`,
      };
    }
    case "commentCreated":
      return {
        heading: `Neuer Kommentar in ${input.spaceName}`,
        detail: `${by ?? "Jemand"} hat kommentiert`,
      };
    case "announcementPublished":
      return { heading: `Ankündigung von ${input.organizationName}`, detail: null };
    case "test":
      return {
        heading: "Testnachricht von Pagehall",
        detail: `Dieser Kanal ist als „${input.channelName}“ verbunden. Die gewählten Nachrichten erscheinen hier.`,
      };
  }
}

export function chatTexts(event: ChatEvent | "test", language: Language, input: ChatTextInput): ChatTexts {
  const texts = language === "de" ? german(event, input) : english(event, input);
  return { ...texts, linkLabel: language === "de" ? "In Pagehall öffnen" : "Open in Pagehall" };
}
