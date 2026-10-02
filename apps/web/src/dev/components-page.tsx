import { accentKeys } from "@pagehall/tokens";
import {
  type Appearance,
  Avatar,
  applyAppearance,
  Badge,
  Button,
  ButtonGroup,
  type ButtonSize,
  type ButtonVariant,
  Checkbox,
  CommandPalette,
  ConfirmDialog,
  Dialog,
  Drawer,
  DurationInput,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Kbd,
  List,
  ListRow,
  Menu,
  Notice,
  type NoticeVariant,
  PageHeader,
  PasswordInput,
  Popover,
  RadioGroup,
  Rail,
  RailButton,
  SaveStatus,
  Section,
  SegmentedControl,
  Select,
  SettingRow,
  Sidebar,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
  Skeleton,
  SkeletonText,
  Spinner,
  Stepper,
  Switch,
  Table,
  type TableSort,
  Tabs,
  Textarea,
  ToastProvider,
  Tooltip,
  TruncatedText,
  type UiLabels,
  UiProvider,
  useToast,
} from "@pagehall/ui";
import {
  Bell,
  Building2,
  CircleHelp,
  Copy,
  Fingerprint,
  House,
  KeyRound,
  Link,
  Lock,
  MoreHorizontal,
  Palette,
  Plus,
  Search,
  Settings,
  Share2,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from "react";

export type PageLanguage = "en" | "de";

const LABELS: Record<PageLanguage, UiLabels> = {
  en: {
    close: "Close",
    sortAscending: "Sort ascending",
    sortDescending: "Sort descending",
    notSorted: "Not sorted",
    previousPage: "Previous page",
    nextPage: "Next page",
    page: "Pages",
    loading: "Loading",
    dismiss: "Dismiss",
    showPassword: "Show password",
    hidePassword: "Hide password",
    clear: "Clear",
    required: "Required",
    optional: "Optional",
    breadcrumbs: "Breadcrumbs",
    notifications: "Notifications",
    decrease: "Decrease",
    increase: "Increase",
    resetToDefault: "Default",
    saving: "Saving",
    saved: "Saved",
    retry: "Try again",
    copy: "Copy",
    copied: "Copied",
    documentation: "Read the documentation",
    durationUnit: "Unit",
    minutes: "Minutes",
    hours: "Hours",
    days: "Days",
  },
  de: {
    close: "Schließen",
    sortAscending: "Aufsteigend sortiert",
    sortDescending: "Absteigend sortiert",
    notSorted: "Nicht sortiert",
    previousPage: "Vorherige Seite",
    nextPage: "Nächste Seite",
    page: "Seiten",
    loading: "Wird geladen",
    dismiss: "Ausblenden",
    showPassword: "Passwort anzeigen",
    hidePassword: "Passwort verbergen",
    clear: "Leeren",
    required: "Pflichtfeld",
    optional: "Optional",
    breadcrumbs: "Pfadnavigation",
    notifications: "Benachrichtigungen",
    decrease: "Verringern",
    increase: "Erhöhen",
    resetToDefault: "Standard",
    saving: "Wird gespeichert",
    saved: "Gespeichert",
    retry: "Erneut versuchen",
    copy: "Kopieren",
    copied: "Kopiert",
    documentation: "Zur Dokumentation",
    durationUnit: "Einheit",
    minutes: "Minuten",
    hours: "Stunden",
    days: "Tage",
  },
};

const LanguageContext = createContext<PageLanguage>("en");

function useText(): (english: string, german: string) => string {
  const language = useContext(LanguageContext);
  return (english, german) => (language === "de" ? german : english);
}

const BUTTON_VARIANTS: ButtonVariant[] = ["primary", "secondary", "outline", "danger", "dangerPrimary"];
const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg"];
const NOTICE_VARIANTS: NoticeVariant[] = ["info", "success", "warning", "danger"];
const TEXT_SIZES = [0.875, 0.9375, 1, 1.125, 1.25];

function useMembers() {
  const t = useText();
  return [
    {
      id: "1",
      name: "Lena Hofer",
      email: "lena.hofer@example.org",
      type: t("Member", "Mitglied"),
      role: "Admin",
    },
    {
      id: "2",
      name: "Tomas Kern",
      email: "tomas.kern@example.org",
      type: t("Member", "Mitglied"),
      role: t("Member", "Mitglied"),
    },
    {
      id: "3",
      name: "Jonas Weber",
      email: "jonas.weber@digital.example.org",
      type: t("Collaborator", "Mitarbeitende Person"),
      role: t("Member", "Mitglied"),
    },
    {
      id: "4",
      name: "Anna Roth",
      email: "anna@freelance.example",
      type: t("Guest", "Gast"),
      role: t("Guest", "Gast"),
    },
  ];
}

export type Overlay = "dialog" | "confirm" | "drawer" | "menu" | "popover" | "palette";

export interface ComponentsPageOptions {
  appearance: Appearance;
  overlay: Overlay | null;
  language: PageLanguage;
}

export function optionsFromSearch(search: string): ComponentsPageOptions {
  const params = new URLSearchParams(search);
  const mode = params.get("mode");
  const size = Number(params.get("size"));
  const accent = params.get("accent");
  const overlay = params.get("overlay");
  return {
    appearance: {
      colorMode: mode === "light" || mode === "dark" ? mode : "system",
      highContrast: params.get("contrast") === "high",
      textSize: TEXT_SIZES.includes(size) ? size : 1,
      density: params.get("density") === "compact" ? "compact" : "default",
      font: params.get("font") === "readable" ? "readable" : "default",
      accent: accent && (accentKeys as string[]).includes(accent) ? accent : null,
    },
    overlay: ["dialog", "confirm", "drawer", "menu", "popover", "palette"].includes(overlay ?? "")
      ? (overlay as Overlay)
      : null,
    language: params.get("lang") === "de" ? "de" : "en",
  };
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-heading">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function Buttons() {
  const t = useText();
  return (
    <Group title={t("Buttons", "Schaltflächen")}>
      <div className="flex flex-col gap-3">
        {BUTTON_SIZES.map((size) => (
          <div key={size} className="flex flex-wrap items-center gap-2">
            {BUTTON_VARIANTS.map((variant) => (
              <Button
                key={variant}
                variant={variant}
                size={size}
                icon={variant === "primary" ? Plus : undefined}
              >
                {variant} {size}
              </Button>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading>
            {t("Saving", "Wird gespeichert")}
          </Button>
          <Button variant="primary" disabled>
            {t("Disabled", "Deaktiviert")}
          </Button>
          <Button variant="outline" disabled>
            {t("Disabled", "Deaktiviert")}
          </Button>
          <ButtonGroup label={t("Sharing", "Teilen")}>
            <Button icon={Share2}>{t("Share", "Teilen")}</Button>
            <Button icon={Link}>{t("Copy link", "Link kopieren")}</Button>
          </ButtonGroup>
          <IconButton label={t("More actions", "Weitere Aktionen")} icon={MoreHorizontal} />
          <IconButton label={t("Copy", "Kopieren")} icon={Copy} variant="outline" />
          <IconButton label={t("Create", "Erstellen")} icon={Plus} variant="primary" />
          <IconButton
            label={t("Notifications, 3 unread", "Benachrichtigungen, 3 ungelesen")}
            icon={Bell}
            badge={3}
          />
        </div>
      </div>
    </Group>
  );
}

function Display() {
  const t = useText();
  const members = useMembers();
  return (
    <Group title={t("Badges, avatars and indicators", "Badges, Avatare und Anzeigen")}>
      <Badge>{t("Member", "Mitglied")}</Badge>
      <Badge variant="accent">{t("This device", "Dieses Gerät")}</Badge>
      <Badge variant="success">{t("On", "An")}</Badge>
      <Badge variant="warning">{t("Guest", "Gast")}</Badge>
      <Badge variant="danger">{t("Error", "Fehler")}</Badge>
      <Badge variant="info" icon={Lock}>
        {t("Locked", "Gesperrt")}
      </Badge>
      {members.map((member) => (
        <Avatar key={member.id} name={member.name} />
      ))}
      <Avatar name="Marcel S." size="sm" />
      <Avatar name="Marcel S." size="lg" />
      <Spinner label={t("Loading", "Wird geladen")} />
      <span className="inline-flex gap-1">
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </span>
      <Tooltip content={t("Tooltip text", "Text des Tooltips")}>
        <Button variant="outline">{t("With tooltip", "Mit Tooltip")}</Button>
      </Tooltip>
    </Group>
  );
}

function Forms() {
  const t = useText();
  const pageLanguage = useContext(LanguageContext);
  const [language, setLanguage] = useState("en");
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [off, setOff] = useState(false);
  const [start, setStart] = useState("empty");
  const [mode, setMode] = useState("system");
  const [size, setSize] = useState(1);
  return (
    <Group title={t("Form controls", "Eingabeelemente")}>
      <div className="grid w-full gap-4 md:grid-cols-2">
        <Field
          label={t("E-mail", "E-Mail")}
          hint={t("Used for sign-in and notifications.", "Für die Anmeldung und Benachrichtigungen.")}
        >
          <Input type="email" defaultValue="lena.hofer@example.org" />
        </Field>
        <Field
          label={t("Password", "Passwort")}
          error={t("At least 12 characters.", "Mindestens 12 Zeichen.")}
          required
        >
          <PasswordInput defaultValue="short" />
        </Field>
        <Field label={t("Language", "Sprache")}>
          <Select
            value={language}
            onValueChange={setLanguage}
            options={[
              { value: "en", label: "English" },
              { value: "de", label: "Deutsch" },
            ]}
          />
        </Field>
        <Field label={t("Date format", "Datumsformat")}>
          <Select
            value="DD.MM.YYYY"
            onValueChange={() => {}}
            options={[
              { value: "DD.MM.YYYY", label: "DD.MM.YYYY (01.10.2026)" },
              { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2026-10-01)" },
            ]}
          />
        </Field>
        <Field label={t("Reason", "Begründung")}>
          <Textarea
            defaultValue={t(
              "The owners are unreachable during an outage.",
              "Die Eigentümer sind während eines Ausfalls nicht erreichbar.",
            )}
          />
        </Field>
        <Field label={t("Disabled", "Deaktiviert")}>
          <Input disabled defaultValue={t("Cannot be changed", "Kann nicht geändert werden")} />
        </Field>
        <Checkbox
          checked={checked}
          onCheckedChange={setChecked}
          label={t("I stored both keys in a safe place", "Ich habe beide Schlüssel sicher aufbewahrt")}
          description={t("For example in a password manager.", "Zum Beispiel in einem Passwortmanager.")}
        />
        <Field
          label={t("Session length", "Sitzungsdauer")}
          hint={t("Signed-in people stay signed in this long.", "So lange bleiben Personen angemeldet.")}
        >
          <DurationInput
            value={43200}
            quickChoices={[1440, 10080, 43200]}
            units={["hours", "days"]}
            locale={pageLanguage}
          />
        </Field>
      </div>
      <div className="flex w-full flex-col gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          label={t("Reading-friendly font", "Leseschrift")}
        />
        <Switch checked={off} onCheckedChange={setOff} label={t("Compact density", "Kompakte Dichte")} />
        <Switch
          checked
          onCheckedChange={() => {}}
          label={t("Locked setting", "Gesperrte Einstellung")}
          disabled
          disabledReason={t("Locked by the instance", "Von der Instanz gesperrt")}
        />
        <Switch
          checked={false}
          onCheckedChange={() => {}}
          label={t("Disabled and off", "Deaktiviert und aus")}
          disabled
        />
      </div>
      <SegmentedControl
        label={t("Color mode", "Farbmodus")}
        value={mode}
        onValueChange={setMode}
        options={[
          { value: "system", label: t("Automatic", "Automatisch") },
          { value: "light", label: t("Light", "Hell") },
          { value: "dark", label: t("Dark", "Dunkel") },
        ]}
      />
      <Stepper
        label={t("Text size", "Textgröße")}
        value={size}
        onValueChange={setSize}
        steps={TEXT_SIZES}
        defaultValue={1}
        formatValue={(value) => `${value * 100} %`}
      />
      <Stepper
        label={t("Text size, changed", "Textgröße, geändert")}
        value={1.125}
        onValueChange={() => {}}
        steps={TEXT_SIZES}
        defaultValue={1}
        formatValue={(value) => `${value * 100} %`}
      />
      <div className="flex w-full flex-wrap items-center gap-4">
        <SaveStatus state="saving" />
        <SaveStatus state="saved" hideSavedAfter={null} />
        <SaveStatus
          state="error"
          error={t("The value could not be saved.", "Der Wert konnte nicht gespeichert werden.")}
          onRetry={() => {}}
        />
      </div>
      <div className="grid w-full gap-4 md:grid-cols-2">
        <RadioGroup
          label={t("Account type", "Kontotyp")}
          value="member"
          onValueChange={() => {}}
          options={[
            { value: "member", label: t("Member", "Mitglied") },
            {
              value: "guest",
              label: t("Guest", "Gast"),
              description: t("Sees only what is shared.", "Sieht nur, was geteilt wird."),
            },
          ]}
        />
        <RadioGroup
          label={t("How do you want to start?", "Wie möchtest du beginnen?")}
          variant="card"
          value={start}
          onValueChange={setStart}
          options={[
            {
              value: "empty",
              label: t("Empty", "Leer"),
              description: t("Start with an empty organization.", "Mit einer leeren Organisation beginnen."),
            },
            {
              value: "sample",
              label: t("With sample content", "Mit Beispielinhalten"),
              description: t("A sample space to explore.", "Ein Beispielbereich zum Erkunden."),
            },
          ]}
        />
      </div>
    </Group>
  );
}

function Feedback() {
  const t = useText();
  return (
    <Group title={t("Notices, empty states and skeletons", "Hinweise, leere Zustände und Platzhalter")}>
      <div className="flex w-full flex-col gap-3">
        {NOTICE_VARIANTS.map((variant) => (
          <Notice key={variant} variant={variant} title={`Notice ${variant}`}>
            {t("Last synchronized 14 minutes ago.", "Zuletzt vor 14 Minuten synchronisiert.")}
          </Notice>
        ))}
        <Notice
          variant="info"
          action={<Button variant="outline">{t("How to update", "So aktualisierst du")}</Button>}
        >
          {t("Version 1.5.0 is available.", "Version 1.5.0 ist verfügbar.")}
        </Notice>
        <ErrorState
          title={t("The file store is not writable", "Der Dateispeicher ist nicht beschreibbar")}
          cause={t(
            "Pagehall runs as user 1000, which cannot write to /var/lib/pagehall/files.",
            "Pagehall läuft als Benutzer 1000, der nicht in /var/lib/pagehall/files schreiben darf.",
          )}
          action={t(
            "Give this user ownership of the directory, then check again.",
            "Übertrage den Besitz des Verzeichnisses an diesen Benutzer und prüfe erneut.",
          )}
          command="chown -R 1000:1000 /var/lib/pagehall/files"
          documentationUrl="#documentation"
          onRetry={() => {}}
          retryLabel={t("Check again", "Erneut prüfen")}
        />
        <ErrorState
          variant="warning"
          title={t("The members could not be loaded", "Die Mitglieder konnten nicht geladen werden")}
          cause={t("The server did not answer in time.", "Der Server hat nicht rechtzeitig geantwortet.")}
          onRetry={() => {}}
        />
        <EmptyState
          icon={Users}
          title={t("No groups yet", "Noch keine Gruppen")}
          description={t(
            "Groups collect people so that you can give them access together.",
            "Gruppen fassen Personen zusammen, damit du ihnen gemeinsam Zugriff geben kannst.",
          )}
          action={<Button variant="primary">{t("Create group", "Gruppe erstellen")}</Button>}
        />
        <Skeleton className="w-1/2" />
        <SkeletonText lines={3} />
      </div>
    </Group>
  );
}

function Data() {
  const t = useText();
  const members = useMembers();
  const [tab, setTab] = useState("all");
  const [sort, setSort] = useState<TableSort>({ key: "name", direction: "asc" });
  const rows = [...members].sort((left, right) =>
    sort.direction === "asc" ? left.name.localeCompare(right.name) : right.name.localeCompare(left.name),
  );
  return (
    <Group title={t("Tabs, tables and lists", "Reiter, Tabellen und Listen")}>
      <div className="flex w-full flex-col gap-4">
        <Tabs
          label={t("Member types", "Mitgliedsarten")}
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "all", label: t("All", "Alle"), count: 4 },
            { value: "collaborators", label: t("Collaborators", "Mitarbeitende"), count: 1 },
            { value: "guests", label: t("Guests", "Gäste"), count: 1 },
          ]}
        >
          <Table
            caption={t("Members", "Mitglieder")}
            columns={[
              {
                key: "name",
                header: t("Name", "Name"),
                sortable: true,
                cell: (row) => (
                  <span className="flex items-center gap-2">
                    <Avatar name={row.name} size="sm" decorative />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{row.name}</span>
                      <TruncatedText text={row.email} className="text-sm text-text-muted" />
                    </span>
                  </span>
                ),
              },
              {
                key: "type",
                header: t("Type", "Art"),
                cell: (row) => <Badge>{row.type}</Badge>,
                hideBelow: "sm",
              },
              { key: "role", header: t("Role", "Rolle"), cell: (row) => row.role },
              {
                key: "actions",
                header: t("Actions", "Aktionen"),
                align: "end",
                cell: (row) => (
                  <IconButton
                    label={t(`Actions for ${row.name}`, `Aktionen für ${row.name}`)}
                    icon={MoreHorizontal}
                    tooltip={false}
                  />
                ),
              },
            ]}
            rows={rows}
            rowKey={(row) => row.id}
            sort={sort}
            onSortChange={setSort}
            pagination={{ hasPrevious: false, hasNext: true, onPrevious: () => {}, onNext: () => {} }}
          />
        </Tabs>
        <Table
          caption={t("Empty", "Leer")}
          columns={[{ key: "name", header: t("Name", "Name"), cell: () => null }]}
          rows={[]}
          rowKey={() => ""}
          empty={t("No members match.", "Keine passenden Mitglieder.")}
        />
        <Table
          caption={t("Loading", "Wird geladen")}
          columns={[{ key: "name", header: t("Name", "Name"), cell: () => null }]}
          rows={[]}
          rowKey={() => ""}
          loading
        />
      </div>
    </Group>
  );
}

function Layout() {
  const t = useText();
  return (
    <Group title={t("Page layout", "Seitenaufbau")}>
      <div className="flex w-full flex-col gap-4">
        <PageHeader
          title={t("Members", "Mitglieder")}
          description={t("People in Platform Team.", "Personen in Platform Team.")}
          icon={Users}
          context="Platform Team"
          breadcrumbs={[
            { label: t("Settings", "Einstellungen"), href: "#settings" },
            { label: t("Members", "Mitglieder") },
          ]}
          actions={
            <Button variant="primary" icon={Plus}>
              {t("Invite people", "Personen einladen")}
            </Button>
          }
        />
        <Section
          title={t("Sign-in", "Anmeldung")}
          icon={Shield}
          actions={<Button size="sm">{t("Edit", "Bearbeiten")}</Button>}
        >
          <SettingRow
            label={t("Session length", "Sitzungsdauer")}
            description={t(
              "How long people stay signed in without activity.",
              "Wie lange Personen ohne Aktivität angemeldet bleiben.",
            )}
            meta={t("Instance default: 12 hours", "Standard der Instanz: 12 Stunden")}
            control={
              <Select
                aria-label={t("Session length", "Sitzungsdauer")}
                value="inherited"
                className="text-text-muted"
                onValueChange={() => {}}
                options={[
                  {
                    value: "inherited",
                    label: t("Use default (12 hours)", "Standard verwenden (12 Stunden)"),
                  },
                  { value: "8", label: t("8 hours", "8 Stunden") },
                  { value: "24", label: t("24 hours", "24 Stunden") },
                ]}
              />
            }
          />
          <SettingRow
            label={t("Require two-factor authentication", "Zwei-Faktor-Authentifizierung verlangen")}
            meta={t("Locked by the instance", "Von der Instanz gesperrt")}
            control={
              <Switch
                checked
                onCheckedChange={() => {}}
                label={t("Require two-factor authentication", "Zwei-Faktor-Authentifizierung verlangen")}
                labelHidden
                disabled
                disabledReason={t("Locked by the instance", "Von der Instanz gesperrt")}
              />
            }
          />
        </Section>
        <Section title={t("API tokens", "API-Tokens")} icon={KeyRound}>
          <List label={t("API tokens", "API-Tokens")}>
            <ListRow
              icon={KeyRound}
              title={t("Backup script", "Sicherungsskript")}
              description={t("Read spaces · expires 31 Dec 2026", "Bereiche lesen · läuft am 31.12.2026 ab")}
              actions={<Button variant="danger">{t("Revoke", "Widerrufen")}</Button>}
            />
            <ListRow icon={Fingerprint} title="Passkeys" description="MacBook Pro · YubiKey 5C" />
          </List>
        </Section>
      </div>
    </Group>
  );
}

function Navigation() {
  const t = useText();
  return (
    <Group title={t("Navigation", "Navigation")}>
      <div className="flex overflow-hidden rounded-md border border-border">
        <Rail
          label={t("Main navigation", "Hauptnavigation")}
          logo={<span className="size-8 rounded-full bg-accent" />}
          footer={
            <>
              <RailButton label={t("Help", "Hilfe")} icon={<CircleHelp className="size-icon-lg" />} />
              <RailButton
                label={t("Settings", "Einstellungen")}
                icon={<Settings className="size-icon-lg" />}
                current
              />
            </>
          }
        >
          <RailButton
            label={t("Create", "Erstellen")}
            icon={<Plus className="size-icon-lg" />}
            variant="primary"
          />
          <RailButton label={t("For you", "Für dich")} icon={<House className="size-icon-lg" />} />
          <RailButton label={t("Search", "Suche")} icon={<Search className="size-icon-lg" />} />
          <RailButton
            label={t("Notifications, 3 unread", "Benachrichtigungen, 3 ungelesen")}
            icon={<Bell className="size-icon-lg" />}
            badge={3}
          />
        </Rail>
        <Sidebar label={t("Settings", "Einstellungen")}>
          <SidebarHeader>{t("Settings", "Einstellungen")}</SidebarHeader>
          <SidebarGroup label={t("My account", "Mein Konto")}>
            <SidebarItem
              icon={Palette}
              label={t("Preferences", "Darstellung und Sprache")}
              href="#preferences"
              current
            />
            <SidebarItem icon={Lock} label={t("Security", "Sicherheit")} href="#security" />
          </SidebarGroup>
          <SidebarGroup label="Platform Team">
            <SidebarItem icon={Building2} label={t("General", "Allgemein")} href="#general" />
            <SidebarItem icon={Users} label={t("Members", "Mitglieder")} href="#members" badge={7} />
            <SidebarItem
              icon={Bell}
              label={t("Notifications of the organization", "Benachrichtigungen der Organisation")}
              href="#notifications"
            />
          </SidebarGroup>
        </Sidebar>
      </div>
    </Group>
  );
}

function ToastButton() {
  const t = useText();
  const { toast } = useToast();
  return (
    <Button
      variant="outline"
      onClick={() => toast({ title: t("Token created", "Token erstellt"), variant: "success" })}
    >
      {t("Show toast", "Meldung anzeigen")}
    </Button>
  );
}

function Overlays({ initial }: { initial: Overlay | null }) {
  const t = useText();
  const [open, setOpen] = useState<Overlay | null>(initial);
  const toggle = (overlay: Overlay) => (next: boolean) => setOpen(next ? overlay : null);
  return (
    <Group title={t("Overlays", "Überlagerungen")}>
      <Button variant="outline" onClick={() => setOpen("dialog")}>
        {t("Open dialog", "Dialog öffnen")}
      </Button>
      <Button variant="outline" onClick={() => setOpen("confirm")}>
        {t("Open confirmation", "Bestätigung öffnen")}
      </Button>
      <Button variant="outline" onClick={() => setOpen("drawer")}>
        {t("Open drawer", "Seitenleiste öffnen")}
      </Button>
      <Button variant="outline" onClick={() => setOpen("palette")}>
        {t("Open command palette", "Befehlspalette öffnen")}
      </Button>
      <Menu
        trigger={<Button variant="outline">{t("Open menu", "Menü öffnen")}</Button>}
        items={[
          { type: "label", label: "Lena Hofer" },
          { label: t("Change role", "Rolle ändern"), icon: Shield, onSelect: () => {} },
          { label: t("Copy e-mail", "E-Mail kopieren"), icon: Copy, onSelect: () => {}, shortcut: "Ctrl C" },
          { type: "separator" },
          {
            label: t("Remove from organization", "Aus der Organisation entfernen"),
            icon: Trash2,
            onSelect: () => {},
            danger: true,
          },
        ]}
      />
      <Popover
        trigger={<Button variant="outline">{t("Open popover", "Popover öffnen")}</Button>}
        label={t("Synchronization", "Synchronisierung")}
      >
        <p>
          {t(
            "Last synchronized 14 minutes ago. 24 members, no changes.",
            "Zuletzt vor 14 Minuten synchronisiert. 24 Mitglieder, keine Änderungen.",
          )}
        </p>
      </Popover>
      <ToastButton />
      <Dialog
        open={open === "dialog"}
        onOpenChange={toggle("dialog")}
        title={t("Invite people", "Personen einladen")}
        description={t("Invitations expire after 7 days.", "Einladungen laufen nach 7 Tagen ab.")}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {t("Cancel", "Abbrechen")}
            </Button>
            <Button variant="primary">{t("Send invitations", "Einladungen senden")}</Button>
          </>
        }
      >
        <Field
          label={t("E-mail addresses", "E-Mail-Adressen")}
          hint={t("Separate with commas or new lines.", "Mit Kommas oder Zeilenumbrüchen trennen.")}
        >
          <Textarea defaultValue="felix.mayr@example.org" />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={open === "confirm"}
        onOpenChange={toggle("confirm")}
        title={t("Remove Anna Roth?", "Anna Roth entfernen?")}
        description={t(
          "Anna Roth loses access to Platform Team and everything shared with her.",
          "Anna Roth verliert den Zugriff auf Platform Team und alles, was mit ihr geteilt wurde.",
        )}
        confirmLabel={t("Remove", "Entfernen")}
        cancelLabel={t("Cancel", "Abbrechen")}
        destructive
        onConfirm={() => {}}
      />
      <Drawer open={open === "drawer"} onOpenChange={toggle("drawer")} title={t("Settings", "Einstellungen")}>
        <p className="p-4">{t("Navigation on small screens.", "Navigation auf kleinen Bildschirmen.")}</p>
      </Drawer>
      <CommandPalette
        open={open === "palette"}
        onOpenChange={toggle("palette")}
        label={t("Command palette", "Befehlspalette")}
        placeholder={t("Search or jump to", "Suchen oder springen zu")}
        emptyText={t("No results", "Keine Ergebnisse")}
        groups={[
          {
            heading: t("Go to", "Gehe zu"),
            items: [
              {
                id: "members",
                label: t("Members", "Mitglieder"),
                icon: Users,
                shortcut: ["G", "M"],
                onSelect: () => {},
              },
              { id: "security", label: t("Security", "Sicherheit"), icon: Lock, onSelect: () => {} },
            ],
          },
          {
            heading: t("Actions", "Aktionen"),
            items: [
              {
                id: "invite",
                label: t("Invite people", "Personen einladen"),
                icon: Plus,
                onSelect: () => {},
              },
            ],
          },
        ]}
      />
    </Group>
  );
}

function Page({ overlay }: { overlay: Overlay | null }) {
  const t = useText();
  return (
    <main className="mx-auto flex max-w-page flex-col gap-10 px-4 py-8">
      <h1 className="text-xl font-semibold tracking-heading">{t("Components", "Komponenten")}</h1>
      <Buttons />
      <Display />
      <Forms />
      <Feedback />
      <Data />
      <Layout />
      <Navigation />
      <Overlays initial={overlay} />
    </main>
  );
}

export default function ComponentsPage({ search = window.location.search }: { search?: string }) {
  const options = optionsFromSearch(search);
  const { colorMode, highContrast, textSize, density, font, accent } = options.appearance;
  const { language } = options;
  useLayoutEffect(() => {
    applyAppearance(document.documentElement, { colorMode, highContrast, textSize, density, font, accent });
    document.documentElement.lang = language;
  }, [colorMode, highContrast, textSize, density, font, accent, language]);
  return (
    <LanguageContext.Provider value={language}>
      <UiProvider labels={LABELS[language]}>
        <ToastProvider>
          <Page overlay={options.overlay} />
        </ToastProvider>
      </UiProvider>
    </LanguageContext.Provider>
  );
}
