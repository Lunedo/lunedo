import { Button, type ButtonVariant } from "@pagehall/ui";
import type { LucideIcon } from "lucide-react";
import { useRef } from "react";

export function FileButton({
  label,
  accept,
  busy = false,
  icon,
  variant = "outline",
  disabled = false,
  onFile,
}: {
  label: string;
  accept: string;
  busy?: boolean;
  icon?: LucideIcon;
  variant?: ButtonVariant;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={label}
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      <Button
        variant={variant}
        loading={busy}
        disabled={disabled}
        {...(icon ? { icon } : {})}
        onClick={() => input.current?.click()}
      >
        {label}
      </Button>
    </>
  );
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
