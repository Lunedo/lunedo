import { CircleHelp } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { isValidElement, type ReactNode } from "react";
import { IconButton } from "./button.js";
import { useUiLabels } from "./labels.js";

export function HelpPopover({ label, children }: { label: string; children: ReactNode }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <IconButton size="sm" label={label} icon={CircleHelp} tooltip={false} />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          className="z-50 max-w-dialog-sm rounded-md border border-border bg-surface p-3 text-sm text-text shadow-popover focus-visible:focus-ring"
        >
          <div data-setting-help="">{children}</div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

export function SettingHelp({ subject, children }: { subject: ReactNode; children: ReactNode }) {
  const labels = useUiLabels();
  const text = textOf(subject).trim();
  return (
    <HelpPopover label={text ? `${labels.moreAbout}: ${text}` : labels.moreAbout}>{children}</HelpPopover>
  );
}
