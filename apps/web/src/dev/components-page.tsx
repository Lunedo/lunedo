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
  EmptyState,
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
  Slider,
  Spinner,
  Switch,
  Table,
  type TableSort,
  Tabs,
  Textarea,
  ToastProvider,
  Tooltip,
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
import { type ReactNode, useLayoutEffect, useState } from "react";

const labels: UiLabels = {
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
};

const BUTTON_VARIANTS: ButtonVariant[] = ["primary", "secondary", "outline", "danger", "dangerPrimary"];
const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg"];
const NOTICE_VARIANTS: NoticeVariant[] = ["info", "success", "warning", "danger"];
const TEXT_SIZES = [0.875, 0.9375, 1, 1.125, 1.25];

const MEMBERS = [
  { id: "1", name: "Lena Hofer", email: "lena.hofer@example.org", type: "Member", role: "Admin" },
  { id: "2", name: "Tomas Kern", email: "tomas.kern@example.org", type: "Member", role: "Member" },
  {
    id: "3",
    name: "Jonas Weber",
    email: "jonas.weber@digital.example.org",
    type: "Collaborator",
    role: "Member",
  },
  { id: "4", name: "Anna Roth", email: "anna@freelance.example", type: "Guest", role: "Guest" },
];

export type Overlay = "dialog" | "confirm" | "drawer" | "menu" | "popover" | "palette";

export interface ComponentsPageOptions {
  appearance: Appearance;
  overlay: Overlay | null;
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
  return (
    <Group title="Buttons">
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
            Saving
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="outline" disabled>
            Disabled
          </Button>
          <ButtonGroup label="Sharing">
            <Button icon={Share2}>Share</Button>
            <Button icon={Link}>Copy link</Button>
          </ButtonGroup>
          <IconButton label="More actions" icon={MoreHorizontal} />
          <IconButton label="Copy" icon={Copy} variant="outline" />
          <IconButton label="Create" icon={Plus} variant="primary" />
          <IconButton label="Notifications, 3 unread" icon={Bell} badge={3} />
        </div>
      </div>
    </Group>
  );
}

function Display() {
  return (
    <Group title="Badges, avatars and indicators">
      <Badge>Member</Badge>
      <Badge variant="accent">This device</Badge>
      <Badge variant="success">On</Badge>
      <Badge variant="warning">Guest</Badge>
      <Badge variant="danger">Error</Badge>
      <Badge variant="info" icon={Lock}>
        Locked
      </Badge>
      {MEMBERS.map((member) => (
        <Avatar key={member.id} name={member.name} />
      ))}
      <Avatar name="Marcel S." size="sm" />
      <Avatar name="Marcel S." size="lg" />
      <Spinner label="Loading" />
      <span className="inline-flex gap-1">
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </span>
      <Tooltip content="Tooltip text">
        <Button variant="outline">With tooltip</Button>
      </Tooltip>
    </Group>
  );
}

function Forms() {
  const [language, setLanguage] = useState("en");
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [start, setStart] = useState("empty");
  const [mode, setMode] = useState("system");
  const [size, setSize] = useState(1);
  return (
    <Group title="Form controls">
      <div className="grid w-full gap-4 md:grid-cols-2">
        <Field label="E-mail" hint="Used for sign-in and notifications.">
          <Input type="email" defaultValue="lena.hofer@example.org" />
        </Field>
        <Field label="Password" error="At least 12 characters." required>
          <PasswordInput defaultValue="short" />
        </Field>
        <Field label="Language">
          <Select
            value={language}
            onValueChange={setLanguage}
            options={[
              { value: "en", label: "English" },
              { value: "de", label: "Deutsch" },
            ]}
          />
        </Field>
        <Field label="Reason">
          <Textarea defaultValue="The owners are unreachable during an outage." />
        </Field>
        <Field label="Disabled">
          <Input disabled defaultValue="Cannot be changed" />
        </Field>
        <Checkbox
          checked={checked}
          onCheckedChange={setChecked}
          label="I stored both keys in a safe place"
          description="For example in a password manager."
        />
      </div>
      <Switch checked={enabled} onCheckedChange={setEnabled} label="Reading-friendly font" />
      <Switch checked onCheckedChange={() => {}} label="Locked setting" disabled />
      <SegmentedControl
        label="Color mode"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: "system", label: "Automatic" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
      <Slider
        label="Text size"
        value={size}
        onValueChange={setSize}
        steps={TEXT_SIZES}
        formatValue={(value) => `${Math.round(value * 100)} %`}
      />
      <div className="grid w-full gap-4 md:grid-cols-2">
        <RadioGroup
          label="Account type"
          value="member"
          onValueChange={() => {}}
          options={[
            { value: "member", label: "Member" },
            { value: "guest", label: "Guest", description: "Sees only what is shared." },
          ]}
        />
        <RadioGroup
          label="How do you want to start?"
          variant="card"
          value={start}
          onValueChange={setStart}
          options={[
            { value: "empty", label: "Empty", description: "Start with an empty organization." },
            { value: "sample", label: "With sample content", description: "A sample space to explore." },
          ]}
        />
      </div>
    </Group>
  );
}

function Feedback() {
  return (
    <Group title="Notices, empty states and skeletons">
      <div className="flex w-full flex-col gap-3">
        {NOTICE_VARIANTS.map((variant) => (
          <Notice key={variant} variant={variant} title={`Notice ${variant}`}>
            Last synchronized 14 minutes ago.
          </Notice>
        ))}
        <Notice variant="info" action={<Button variant="outline">How to update</Button>}>
          Version 1.5.0 is available.
        </Notice>
        <EmptyState
          icon={Users}
          title="No groups yet"
          description="Groups collect people so that you can give them access together."
          action={<Button variant="primary">Create group</Button>}
        />
        <Skeleton className="w-1/2" />
        <SkeletonText lines={3} />
      </div>
    </Group>
  );
}

function Data() {
  const [tab, setTab] = useState("all");
  const [sort, setSort] = useState<TableSort>({ key: "name", direction: "asc" });
  const rows = [...MEMBERS].sort((left, right) =>
    sort.direction === "asc" ? left.name.localeCompare(right.name) : right.name.localeCompare(left.name),
  );
  return (
    <Group title="Tabs, tables and lists">
      <div className="flex w-full flex-col gap-4">
        <Tabs
          label="Member types"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "all", label: "All", count: 4 },
            { value: "collaborators", label: "Collaborators", count: 1 },
            { value: "guests", label: "Guests", count: 1 },
          ]}
        >
          <Table
            caption="Members"
            columns={[
              {
                key: "name",
                header: "Name",
                sortable: true,
                cell: (row) => (
                  <span className="flex items-center gap-2">
                    <Avatar name={row.name} size="sm" decorative />
                    <span className="flex flex-col">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-sm text-text-muted">{row.email}</span>
                    </span>
                  </span>
                ),
              },
              { key: "type", header: "Type", cell: (row) => <Badge>{row.type}</Badge>, hideBelow: "sm" },
              { key: "role", header: "Role", cell: (row) => row.role },
              {
                key: "actions",
                header: "Actions",
                align: "end",
                cell: (row) => (
                  <IconButton label={`Actions for ${row.name}`} icon={MoreHorizontal} tooltip={false} />
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
          caption="Empty"
          columns={[{ key: "name", header: "Name", cell: () => null }]}
          rows={[]}
          rowKey={() => ""}
          empty="No members match."
        />
        <Table
          caption="Loading"
          columns={[{ key: "name", header: "Name", cell: () => null }]}
          rows={[]}
          rowKey={() => ""}
          loading
        />
      </div>
    </Group>
  );
}

function Layout() {
  return (
    <Group title="Page layout">
      <div className="flex w-full flex-col gap-4">
        <PageHeader
          title="Members"
          description="People in Platform Team."
          icon={Users}
          context="Platform Team"
          breadcrumbs={[{ label: "Settings", href: "#settings" }, { label: "Members" }]}
          actions={
            <Button variant="primary" icon={Plus}>
              Invite people
            </Button>
          }
        />
        <Section title="Sign-in" icon={Shield} actions={<Button size="sm">Edit</Button>}>
          <SettingRow
            label="Session length"
            description="How long people stay signed in without activity."
            meta="Instance default: 12 hours"
            control={<Button variant="outline">Override</Button>}
          />
          <SettingRow
            label="Require two-factor authentication"
            meta="Locked by the instance"
            control={
              <Switch
                checked
                onCheckedChange={() => {}}
                label="Require two-factor authentication"
                labelHidden
                disabled
              />
            }
          />
        </Section>
        <Section title="API tokens" icon={KeyRound}>
          <List label="API tokens">
            <ListRow
              icon={KeyRound}
              title="Backup script"
              description="Read spaces · expires 31 Dec 2026"
              actions={<Button variant="danger">Revoke</Button>}
            />
            <ListRow icon={Fingerprint} title="Passkeys" description="MacBook Pro · YubiKey 5C" />
          </List>
        </Section>
      </div>
    </Group>
  );
}

function Navigation() {
  return (
    <Group title="Navigation">
      <div className="flex overflow-hidden rounded-md border border-border">
        <Rail
          label="Main navigation"
          logo={<span className="size-8 rounded-full bg-accent" />}
          footer={
            <>
              <RailButton label="Help" icon={<CircleHelp className="size-icon-lg" />} />
              <RailButton label="Settings" icon={<Settings className="size-icon-lg" />} current />
            </>
          }
        >
          <RailButton label="Create" icon={<Plus className="size-icon-lg" />} variant="primary" />
          <RailButton label="For you" icon={<House className="size-icon-lg" />} />
          <RailButton label="Search" icon={<Search className="size-icon-lg" />} />
          <RailButton label="Notifications, 3 unread" icon={<Bell className="size-icon-lg" />} badge={3} />
        </Rail>
        <Sidebar label="Settings">
          <SidebarHeader>Settings</SidebarHeader>
          <SidebarGroup label="My account">
            <SidebarItem icon={Palette} label="Preferences" href="#preferences" current />
            <SidebarItem icon={Lock} label="Security" href="#security" />
          </SidebarGroup>
          <SidebarGroup label="Platform Team">
            <SidebarItem icon={Building2} label="General" href="#general" />
            <SidebarItem icon={Users} label="Members" href="#members" badge={7} />
          </SidebarGroup>
        </Sidebar>
      </div>
    </Group>
  );
}

function ToastButton() {
  const { toast } = useToast();
  return (
    <Button variant="outline" onClick={() => toast({ title: "Token created", variant: "success" })}>
      Show toast
    </Button>
  );
}

function Overlays({ initial }: { initial: Overlay | null }) {
  const [open, setOpen] = useState<Overlay | null>(initial);
  const toggle = (overlay: Overlay) => (next: boolean) => setOpen(next ? overlay : null);
  return (
    <Group title="Overlays">
      <Button variant="outline" onClick={() => setOpen("dialog")}>
        Open dialog
      </Button>
      <Button variant="outline" onClick={() => setOpen("confirm")}>
        Open confirmation
      </Button>
      <Button variant="outline" onClick={() => setOpen("drawer")}>
        Open drawer
      </Button>
      <Button variant="outline" onClick={() => setOpen("palette")}>
        Open command palette
      </Button>
      <Menu
        trigger={<Button variant="outline">Open menu</Button>}
        items={[
          { type: "label", label: "Lena Hofer" },
          { label: "Change role", icon: Shield, onSelect: () => {} },
          { label: "Copy e-mail", icon: Copy, onSelect: () => {}, shortcut: "Ctrl C" },
          { type: "separator" },
          { label: "Remove from organization", icon: Trash2, onSelect: () => {}, danger: true },
        ]}
      />
      <Popover trigger={<Button variant="outline">Open popover</Button>} label="Synchronization">
        <p>Last synchronized 14 minutes ago. 24 members, no changes.</p>
      </Popover>
      <ToastButton />
      <Dialog
        open={open === "dialog"}
        onOpenChange={toggle("dialog")}
        title="Invite people"
        description="Invitations expire after 7 days."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button variant="primary">Send invitations</Button>
          </>
        }
      >
        <Field label="E-mail addresses" hint="Separate with commas or new lines.">
          <Textarea defaultValue="felix.mayr@example.org" />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={open === "confirm"}
        onOpenChange={toggle("confirm")}
        title="Remove Anna Roth?"
        description="Anna Roth loses access to Platform Team and everything shared with her."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {}}
      />
      <Drawer open={open === "drawer"} onOpenChange={toggle("drawer")} title="Settings">
        <p className="p-4">Navigation on small screens.</p>
      </Drawer>
      <CommandPalette
        open={open === "palette"}
        onOpenChange={toggle("palette")}
        label="Command palette"
        placeholder="Search or jump to"
        emptyText="No results"
        groups={[
          {
            heading: "Go to",
            items: [
              { id: "members", label: "Members", icon: Users, shortcut: ["G", "M"], onSelect: () => {} },
              { id: "security", label: "Security", icon: Lock, onSelect: () => {} },
            ],
          },
          {
            heading: "Actions",
            items: [{ id: "invite", label: "Invite people", icon: Plus, onSelect: () => {} }],
          },
        ]}
      />
    </Group>
  );
}

export default function ComponentsPage({ search = window.location.search }: { search?: string }) {
  const options = optionsFromSearch(search);
  const { colorMode, highContrast, textSize, density, font, accent } = options.appearance;
  useLayoutEffect(() => {
    applyAppearance(document.documentElement, { colorMode, highContrast, textSize, density, font, accent });
  }, [colorMode, highContrast, textSize, density, font, accent]);
  return (
    <UiProvider labels={labels}>
      <ToastProvider>
        <main className="mx-auto flex max-w-page flex-col gap-10 px-4 py-8">
          <h1 className="text-xl font-semibold tracking-heading">Components</h1>
          <Buttons />
          <Display />
          <Forms />
          <Feedback />
          <Data />
          <Layout />
          <Navigation />
          <Overlays initial={options.overlay} />
        </main>
      </ToastProvider>
    </UiProvider>
  );
}
