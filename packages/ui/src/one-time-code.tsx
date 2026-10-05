import { type ComponentProps, useState } from "react";
import { classNames } from "./class-names.js";
import { useFieldControl } from "./field.js";

export interface OneTimeCodeInputProps
  extends Omit<ComponentProps<"input">, "value" | "onChange" | "type" | "inputMode" | "autoComplete"> {
  value: string;
  onValueChange: (value: string) => void;
  length?: number;
  invalid?: boolean;
}

export function cleanCode(value: string, length: number): string {
  return value.replace(/\D/g, "").slice(0, length);
}

export function OneTimeCodeInput({
  value,
  onValueChange,
  length = 6,
  invalid,
  className,
  onFocus,
  onBlur,
  ...props
}: OneTimeCodeInputProps) {
  const field = useFieldControl();
  const [focused, setFocused] = useState(false);
  const digits = cleanCode(value, length);
  const marked = invalid === true || field["aria-invalid"] === true;
  const active = Math.min(digits.length, length - 1);
  return (
    <div data-one-time-code="" className={classNames("relative inline-flex max-w-full", className)}>
      <div aria-hidden="true" className="flex gap-2">
        {Array.from({ length }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a box is identified by its position in the code
            key={index}
            className={classNames(
              "flex size-control-lg items-center justify-center rounded-md border bg-control font-mono text-lg text-text",
              marked ? "border-danger" : "border-control-border",
              focused && index === active && "border-accent focus-ring",
            )}
          >
            {digits[index] ?? ""}
          </span>
        ))}
      </div>
      <input
        {...field}
        {...(invalid ? { "aria-invalid": true } : {})}
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        spellCheck={false}
        value={digits}
        onChange={(event) => onValueChange(cleanCode(event.target.value, length))}
        onFocus={(event) => {
          setFocused(true);
          const end = event.target.value.length;
          event.target.setSelectionRange(end, end);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        className="absolute inset-0 size-full cursor-text opacity-0"
      />
    </div>
  );
}
