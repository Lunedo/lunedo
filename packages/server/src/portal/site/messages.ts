export interface PortalMessages {
  locale: string;
  skipToContent: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchButton: string;
  searchEmpty: string;
  home: (name: string) => string;
  categoriesNavigation: string;
  allTopics: string;
  topics: string;
  openMenu: string;
  closeMenu: string;
  account: (name: string) => string;
  signIn: string;
  signOut: string;
  appLinkDefault: string;
  footerContact: (email: string) => string;
  poweredBy: string;
  defaultHeading: string;
  frequentSearches: string;
  topicsHeading: string;
  articleCount: (count: number) => string;
  mostRead: string;
  recentlyUpdated: string;
  updatedOnShort: (date: string) => string;
  noAnswerHeading: string;
  noAnswerText: string;
  writeUs: string;
  emptyHeading: string;
  emptyText: string;
  types: { howTo: string; troubleshooting: string };
  filters: { all: string; howTo: string; troubleshooting: string };
  breadcrumb: string;
  contactLine: (category: string) => string;
  subcategories: string;
  allArticlesIn: (category: string) => string;
  articleTypeGroup: string;
  sortLabel: string;
  sorts: { views: string; updated: string; title: string };
  moreArticles: string;
  noArticlesOfType: string;
  edit: string;
  editHint: string;
  updatedOnLong: (date: string) => string;
  onThisPage: string;
  giveFeedback: string;
  helpfulQuestion: string;
  yes: string;
  no: string;
  ratingHint: string;
  thanks: string;
  missingLabel: string;
  missingPlaceholder: string;
  missingHint: string;
  sendHint: string;
  skipHint: string;
  sentThanks: string;
  sentThanksWithText: string;
  feedbackFailed: string;
  feedbackTooLong: string;
  retry: string;
  contactHeading: string;
  mailButton: string;
  copyAddress: string;
  copied: string;
  copyFailed: (email: string) => string;
  contactHint: (email: string, subject: string) => string;
  noContact: string;
  mailSubject: (title: string) => string;
  mailBody: (url: string) => string;
  relatedTroubleshooting: string;
  similarArticles: string;
  resultsFor: (count: number, query: string) => string;
  filterByCategory: string;
  notRightHeading: string;
  notRightText: string;
  contactByArea: string;
  reviewedOnLong: (date: string) => string;
  didYouMean: string;
  noResultsHeading: (query: string) => string;
  noResultsLead: string;
  tipSpelling: string;
  tipSpellingText: string;
  tipGeneral: string;
  tipGeneralText: string;
  tipBrowse: string;
  areaHeading: string;
  areaText: string;
  areaOther: string;
  zeroResultsCounted: string;
  searchSubject: (query: string) => string;
  searchFailedHeading: string;
  staticSearchFailed: string;
  staticSearchNeedsScript: string;
  searchFailedText: (query: string) => string;
  searchAgain: string;
  notFoundHeading: string;
  notFoundLead: string;
  notFoundBrowse: string;
  notFoundLink: string;
  notFoundLinkNoContact: string;
  outdatedLinkSubject: string;
  signInHeading: string;
  signInLead: (name: string) => string;
  signInReturn: (title: string) => string;
  signInWith: (provider: string) => string;
  signInWithEmail: string;
  signInProblems: string;
  signInNoMethod: string;
  signInFailed: string;
  signedOutHeading: string;
  signedOutLead: string;
  signInAgain: string;
  consentHeading: (domain: string) => string;
  consentLead: (domain: string) => string;
  consentContinue: string;
  consentCancel: string;
  backToStart: string;
  errorHeading: string;
  errorText: string;
  reload: string;
  previous: string;
  next: string;
  pageOf: (page: number, pages: number) => string;
  languageMenu: string;
  languageCurrent: (language: string) => string;
  fallbackNote: (requested: string, shown: string) => string;
  searchFallbackNote: (requested: string, shown: string) => string;
}

const en: PortalMessages = {
  locale: "en",
  skipToContent: "Skip to content",
  searchLabel: "Search help",
  searchPlaceholder: "What are you looking for?",
  searchButton: "Search",
  searchEmpty: "No search term entered. Enter a word, for example VPN.",
  home: (name) => `${name}, start page`,
  categoriesNavigation: "Categories",
  allTopics: "All topics",
  topics: "Topics",
  openMenu: "Menu and search",
  closeMenu: "Close menu",
  account: (name) => `Account: ${name}`,
  signIn: "Sign in",
  signOut: "Sign out",
  appLinkDefault: "Go to the wiki",
  footerContact: (email) => `Contact: ${email}`,
  poweredBy: "Provided with Pagehall",
  defaultHeading: "How can we help?",
  frequentSearches: "Frequently searched:",
  topicsHeading: "Topics",
  articleCount: (count) => (count === 1 ? "1 article" : `${count} articles`),
  mostRead: "Most read",
  recentlyUpdated: "Recently updated",
  updatedOnShort: (date) => `updated on ${date}`,
  noAnswerHeading: "Didn't find an answer?",
  noAnswerText: "Write to us. Your message goes to the team that looks after the topic.",
  writeUs: "Write to us",
  emptyHeading: "No articles yet",
  emptyText:
    "Nothing has been published here yet, or you cannot read the articles. Sign in or try again later.",
  types: { howTo: "How-to", troubleshooting: "Troubleshooting" },
  filters: { all: "All", howTo: "How-tos", troubleshooting: "Troubleshooting" },
  breadcrumb: "Breadcrumb",
  contactLine: (category) => `Questions about ${category}:`,
  subcategories: "Subcategories",
  allArticlesIn: (category) => `All articles in ${category}`,
  articleTypeGroup: "Article type",
  sortLabel: "Sort",
  sorts: { views: "Most read first", updated: "Recently updated first", title: "Alphabetical" },
  moreArticles: "Show more articles",
  noArticlesOfType: "There are no articles of this type here. Choose another type.",
  edit: "Edit",
  editHint: "Only visible to you",
  updatedOnLong: (date) => `Updated on ${date}`,
  onThisPage: "On this page",
  giveFeedback: "Give feedback",
  helpfulQuestion: "Was this helpful?",
  yes: "Yes",
  no: "No",
  ratingHint: "Your rating is stored without your name.",
  thanks: "Thank you for your feedback.",
  missingLabel: "What was missing? (optional)",
  missingPlaceholder: "For example: step 2 looks different for me.",
  missingHint: "Without your name. The team only sees the text. For an answer, write to us directly.",
  sendHint: "Send note",
  skipHint: "Finish without a note",
  sentThanks: "Thank you. The team sees your rating without your name.",
  sentThanksWithText: "Thank you. The team sees your rating and your note without your name.",
  feedbackFailed:
    "Your feedback was not saved because the server did not answer. Check your connection and send it again.",
  feedbackTooLong: "The note is too long. Shorten it to 2,000 characters and send it again.",
  retry: "Send again",
  contactHeading: "Didn't help? Write to us",
  mailButton: "Write an e-mail",
  copyAddress: "Copy address",
  copied: "Address copied",
  copyFailed: (email) => `The address could not be copied. Select it and copy it yourself: ${email}`,
  contactHint: (email, subject) =>
    `Opens your e-mail program with a message to ${email}, the subject “${subject}” and the link to this article. No e-mail program set up? Copy the address.`,
  noContact: "No contact address is set up for this help yet.",
  mailSubject: (title) => `Help article: ${title}`,
  mailBody: (url) => `Article: ${url}\n\nMy question:\n`,
  relatedTroubleshooting: "Related troubleshooting",
  similarArticles: "Similar articles",
  resultsFor: (count, query) =>
    count === 1 ? `1 article for “${query}”` : `${count} articles for “${query}”`,
  filterByCategory: "Filter by category",
  notRightHeading: "Not what you need?",
  notRightText: "Write to us. Choose the area, and your question goes to the team in charge.",
  contactByArea: "Contact by area",
  reviewedOnLong: (date) => `Last reviewed on ${date}`,
  didYouMean: "Did you mean:",
  noResultsHeading: (query) => `No articles for “${query}”`,
  noResultsLead: "We searched all categories. Another word may help, otherwise write to us.",
  tipSpelling: "Check the spelling",
  tipSpellingText: "A single typo is enough for nothing to be found.",
  tipGeneral: "Search more generally",
  tipGeneralText: "Use fewer or more general words.",
  tipBrowse: "Browse",
  areaHeading: "Not found? Write to us",
  areaText:
    "Choose the area your question belongs to. Your e-mail program opens with the search term as the subject.",
  areaOther: "Something else",
  zeroResultsCounted:
    "Searches without results are counted without your name, so the team can see which articles are missing.",
  searchSubject: (query) => `Question from the help search: ${query}`,
  searchFailedHeading: "Search is not available right now",
  staticSearchFailed:
    "The search index of this help site could not be loaded. The site may be opened from a local folder, which browsers do not allow, or a file is missing on the web server. Open the site through its web address, or find the article through the topics.",
  staticSearchNeedsScript:
    "The search of this help site needs JavaScript. Turn it on in your browser, or find the article through the topics.",
  searchFailedText: (query) =>
    `The search for “${query}” could not run because the search service did not answer. This is not caused by your input. Try again in a minute, or find the article through the topics.`,
  searchAgain: "Search again",
  notFoundHeading: "We can't find this page",
  notFoundLead: "The link may be outdated, or the article was moved or removed. Search for the topic:",
  notFoundBrowse: "Or browse the topics",
  notFoundLink: "Did the link come from an e-mail or a document? Write to us so we can fix it:",
  notFoundLinkNoContact: "Did the link come from an e-mail or a document? Tell the people who sent it.",
  outdatedLinkSubject: "Outdated link in the help",
  signInHeading: "Sign in to read the help",
  signInLead: (name) => `${name} is only available to signed-in people.`,
  signInReturn: (title) => `${title} Afterwards you continue right where you wanted to go.`,
  signInWith: (provider) => `Sign in with ${provider}`,
  signInWithEmail: "Sign in with an e-mail address",
  signInProblems: "Problems signing in? Write to",
  signInNoMethod:
    "No sign-in method is set up for this instance. Ask your instance administrator to set up sign-in.",
  signInFailed: "Sign-in could not be started because the server did not answer. Try again.",
  signedOutHeading: "You are signed out",
  signedOutLead: "You were signed out everywhere, in the help and in the wiki.",
  signInAgain: "Sign in again",
  consentHeading: (domain) => `Sign in to ${domain} with your account?`,
  consentLead: (domain) =>
    `The help portal at ${domain} then sees your name, your e-mail address and what you may read there. Pagehall asks only once for this address.`,
  consentContinue: "Continue",
  consentCancel: "Cancel",
  backToStart: "Back to the start page",
  errorHeading: "This page cannot be shown right now",
  errorText:
    "Something went wrong on the server while loading the page. This is not caused by you. Reload the page in a minute.",
  reload: "Reload",
  previous: "Previous",
  next: "Next",
  pageOf: (page, pages) => `Page ${page} of ${pages}`,
  languageMenu: "Language",
  languageCurrent: (language) => `Language: ${language}`,
  fallbackNote: (requested, shown) =>
    `This article is not available in ${requested} yet, so it is shown in ${shown}.`,
  searchFallbackNote: (requested, shown) =>
    `Nothing was found in ${requested}. These results are in ${shown}.`,
};

const de: PortalMessages = {
  locale: "de",
  skipToContent: "Zum Inhalt springen",
  searchLabel: "Hilfe durchsuchen",
  searchPlaceholder: "Wonach suchst du?",
  searchButton: "Suchen",
  searchEmpty: "Kein Suchbegriff eingegeben. Gib ein Wort ein, zum Beispiel VPN.",
  home: (name) => `${name}, Startseite`,
  categoriesNavigation: "Kategorien",
  allTopics: "Alle Themen",
  topics: "Themen",
  openMenu: "Menü und Suche",
  closeMenu: "Menü schließen",
  account: (name) => `Konto: ${name}`,
  signIn: "Anmelden",
  signOut: "Abmelden",
  appLinkDefault: "Zum Wiki",
  footerContact: (email) => `Kontakt: ${email}`,
  poweredBy: "Bereitgestellt mit Pagehall",
  defaultHeading: "Wie können wir helfen?",
  frequentSearches: "Häufig gesucht:",
  topicsHeading: "Themen",
  articleCount: (count) => `${count} Artikel`,
  mostRead: "Meistgelesen",
  recentlyUpdated: "Zuletzt aktualisiert",
  updatedOnShort: (date) => `aktualisiert am ${date}`,
  noAnswerHeading: "Keine Antwort gefunden?",
  noAnswerText: "Schreib uns. Deine Nachricht geht an das Team, das für das Thema zuständig ist.",
  writeUs: "Schreib uns",
  emptyHeading: "Noch keine Artikel",
  emptyText:
    "Hier ist noch nichts veröffentlicht, oder du darfst die Artikel nicht lesen. Melde dich an oder versuche es später noch einmal.",
  types: { howTo: "Anleitung", troubleshooting: "Störung" },
  filters: { all: "Alle", howTo: "Anleitungen", troubleshooting: "Störungen" },
  breadcrumb: "Pfad",
  contactLine: (category) => `Fragen zu ${category}:`,
  subcategories: "Unterkategorien",
  allArticlesIn: (category) => `Alle Artikel in ${category}`,
  articleTypeGroup: "Artikelart",
  sortLabel: "Sortierung",
  sorts: { views: "Meistgelesen zuerst", updated: "Zuletzt aktualisiert zuerst", title: "Alphabetisch" },
  moreArticles: "Weitere Artikel anzeigen",
  noArticlesOfType: "Hier gibt es keine Artikel dieser Art. Wähle eine andere Artikelart.",
  edit: "Bearbeiten",
  editHint: "Nur für dich sichtbar",
  updatedOnLong: (date) => `Aktualisiert am ${date}`,
  onThisPage: "Auf dieser Seite",
  giveFeedback: "Rückmeldung geben",
  helpfulQuestion: "War das hilfreich?",
  yes: "Ja",
  no: "Nein",
  ratingHint: "Deine Bewertung wird ohne deinen Namen gespeichert.",
  thanks: "Danke für deine Rückmeldung.",
  missingLabel: "Was hat gefehlt? (optional)",
  missingPlaceholder: "Zum Beispiel: Schritt 2 sieht bei mir anders aus.",
  missingHint: "Ohne deinen Namen. Das Team sieht nur den Text. Für eine Antwort schreib uns direkt.",
  sendHint: "Hinweis senden",
  skipHint: "Ohne Hinweis abschließen",
  sentThanks: "Danke. Das Team sieht deine Bewertung ohne deinen Namen.",
  sentThanksWithText: "Danke. Das Team sieht deine Bewertung und deinen Hinweis ohne deinen Namen.",
  feedbackFailed:
    "Deine Rückmeldung wurde nicht gespeichert, weil der Server nicht antwortet. Prüfe deine Verbindung und sende sie noch einmal.",
  feedbackTooLong: "Der Hinweis ist zu lang. Kürze ihn auf 2.000 Zeichen und sende ihn noch einmal.",
  retry: "Erneut senden",
  contactHeading: "Hat nicht geholfen? Schreib uns",
  mailButton: "E-Mail schreiben",
  copyAddress: "Adresse kopieren",
  copied: "Adresse kopiert",
  copyFailed: (email) =>
    `Die Adresse ließ sich nicht kopieren. Markiere sie und kopiere sie selbst: ${email}`,
  contactHint: (email, subject) =>
    `Öffnet dein E-Mail-Programm mit einer Nachricht an ${email}, Betreff „${subject}“ und dem Link zu diesem Artikel. Kein E-Mail-Programm eingerichtet? Kopiere die Adresse.`,
  noContact: "Für diese Hilfe ist noch keine Kontaktadresse hinterlegt.",
  mailSubject: (title) => `Hilfe-Artikel: ${title}`,
  mailBody: (url) => `Artikel: ${url}\n\nMeine Frage:\n`,
  relatedTroubleshooting: "Passende Störungen",
  similarArticles: "Ähnliche Artikel",
  resultsFor: (count, query) => `${count} Artikel zu „${query}“`,
  filterByCategory: "Nach Kategorie filtern",
  notRightHeading: "Nicht das Richtige dabei?",
  notRightText: "Schreib uns. Wähle den Bereich, dann geht deine Frage an das zuständige Team.",
  contactByArea: "Kontakt nach Bereich",
  reviewedOnLong: (date) => `Zuletzt geprüft am ${date}`,
  didYouMean: "Meintest du:",
  noResultsHeading: (query) => `Keine Artikel zu „${query}“`,
  noResultsLead:
    "Wir haben in allen Kategorien gesucht. Vielleicht hilft ein anderes Wort, sonst schreib uns.",
  tipSpelling: "Schreibweise prüfen",
  tipSpellingText: "Ein Tippfehler reicht, damit nichts gefunden wird.",
  tipGeneral: "Allgemeiner suchen",
  tipGeneralText: "Verwende weniger oder allgemeinere Wörter.",
  tipBrowse: "Stöbern",
  areaHeading: "Nicht gefunden? Schreib uns",
  areaText:
    "Wähle den Bereich, zu dem deine Frage gehört. Dein E-Mail-Programm öffnet sich mit dem Suchbegriff als Betreff.",
  areaOther: "Etwas anderes",
  zeroResultsCounted:
    "Suchen ohne Treffer werden ohne deinen Namen gezählt, damit das Team fehlende Artikel erkennt.",
  searchSubject: (query) => `Frage aus der Hilfe-Suche: ${query}`,
  searchFailedHeading: "Die Suche ist gerade nicht erreichbar",
  staticSearchFailed:
    "Der Suchindex dieser Hilfeseite konnte nicht geladen werden. Vielleicht ist die Seite aus einem lokalen Ordner geöffnet, was Browser nicht erlauben, oder eine Datei fehlt auf dem Webserver. Öffne die Seite über ihre Webadresse oder finde den Artikel über die Themen.",
  staticSearchNeedsScript:
    "Die Suche dieser Hilfeseite braucht JavaScript. Schalte es im Browser ein oder finde den Artikel über die Themen.",
  searchFailedText: (query) =>
    `Die Suche nach „${query}“ konnte nicht ausgeführt werden, weil der Suchdienst nicht antwortet. Das liegt nicht an deiner Eingabe. Versuche es in einer Minute noch einmal oder finde den Artikel über die Themen.`,
  searchAgain: "Erneut suchen",
  notFoundHeading: "Diese Seite finden wir nicht",
  notFoundLead:
    "Der Link ist vielleicht veraltet, oder der Artikel wurde verschoben oder entfernt. Such nach dem Thema:",
  notFoundBrowse: "Oder stöbere in den Themen",
  notFoundLink:
    "Du hast den Link aus einer E-Mail oder einem Dokument? Schreib uns, dann korrigieren wir ihn:",
  notFoundLinkNoContact:
    "Du hast den Link aus einer E-Mail oder einem Dokument? Sag es den Personen, die ihn geschickt haben.",
  outdatedLinkSubject: "Veralteter Link in der Hilfe",
  signInHeading: "Melde dich an, um die Hilfe zu lesen",
  signInLead: (name) => `${name} ist nur für angemeldete Personen.`,
  signInReturn: (title) => `${title} Danach geht es direkt dort weiter, wohin du wolltest.`,
  signInWith: (provider) => `Mit ${provider} anmelden`,
  signInWithEmail: "Mit E-Mail-Adresse anmelden",
  signInProblems: "Probleme bei der Anmeldung? Schreib an",
  signInNoMethod:
    "Für diese Instanz ist keine Anmeldung eingerichtet. Bitte die Instanz-Administration, die Anmeldung einzurichten.",
  signInFailed:
    "Die Anmeldung ließ sich nicht starten, weil der Server nicht antwortet. Versuche es noch einmal.",
  signedOutHeading: "Du bist abgemeldet",
  signedOutLead: "Du wurdest überall abgemeldet, in der Hilfe und im Wiki.",
  signInAgain: "Wieder anmelden",
  consentHeading: (domain) => `Bei ${domain} mit deinem Konto anmelden?`,
  consentLead: (domain) =>
    `Das Hilfeportal unter ${domain} sieht dann deinen Namen, deine E-Mail-Adresse und was du dort lesen darfst. Pagehall fragt für diese Adresse nur einmal.`,
  consentContinue: "Weiter",
  consentCancel: "Abbrechen",
  backToStart: "Zur Startseite",
  errorHeading: "Diese Seite kann gerade nicht angezeigt werden",
  errorText:
    "Beim Laden der Seite ist auf dem Server etwas schiefgegangen. Das liegt nicht an dir. Lade die Seite in einer Minute neu.",
  reload: "Neu laden",
  previous: "Zurück",
  next: "Weiter",
  pageOf: (page, pages) => `Seite ${page} von ${pages}`,
  languageMenu: "Sprache",
  languageCurrent: (language) => `Sprache: ${language}`,
  fallbackNote: (requested, shown) =>
    `Diesen Artikel gibt es noch nicht auf ${requested}. Er wird auf ${shown} angezeigt.`,
  searchFallbackNote: (requested, shown) =>
    `Auf ${requested} wurde nichts gefunden. Diese Treffer sind auf ${shown}.`,
};

export function messagesFor(language: string): PortalMessages {
  return language === "de" ? de : en;
}

export function languageName(language: string, inLanguage: string): string {
  try {
    return new Intl.DisplayNames([inLanguage, "en"], { type: "language" }).of(language) ?? language;
  } catch {
    return language;
  }
}
