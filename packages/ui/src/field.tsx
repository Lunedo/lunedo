import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, useContext, useId, useState } from "react";
import { IconButton } from "./button.js";
import { classNames } from "./class-names.js";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export function OutsideField({ children }: { children: ReactNode }) {
  return <FieldContext.Provider value={null}>{children}</FieldContext.Provider>;
}

export interface FieldControlProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

export function useFieldControl(): FieldControlProps {
  const field = useContext(FieldContext);
  if (!field) return {};
  return {
    id: field.id,
    ...(field.describedBy ? { "aria-describedby": field.describedBy } : {}),
    ...(field.invalid ? { "aria-invalid": true } : {}),
    ...(field.required ? { "aria-required": true } : {}),
  };
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  id?: string;
  labelAction?: ReactNode;
  children: ReactNode;
}

export function Field({ label, hint, error, required = false, id, labelAction, children }: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field-${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error), required }}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={controlId} className="font-medium text-text">
            {label}
          </label>
          {labelAction}
        </div>
        {children}
        {error && (
          <p id={errorId} className="text-sm text-danger">
            <Icon icon={CircleAlert} size="sm" className="mr-1 inline align-text-bottom" />
            {error}
          </p>
        )}
        {hint && (
          <p id={hintId} className="text-sm text-text-muted">
            {hint}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

export const controlClassName =
  "w-full min-w-0 rounded-md border border-control-border bg-control px-3 text-base text-text placeholder:text-text-muted focus-visible:border-accent focus-visible:focus-ring disabled:cursor-not-allowed disabled:border-dashed disabled:bg-surface-sunken disabled:text-text-muted aria-invalid:border-danger";

export interface InputProps extends ComponentProps<"input"> {
  invalid?: boolean;
}

export function Input({ invalid, className, ...props }: InputProps) {
  const field = useFieldControl();
  return (
    <input
      {...field}
      {...(invalid ? { "aria-invalid": true } : {})}
      className={classNames(controlClassName, "h-control-field", className)}
      {...props}
    />
  );
}

export function PasswordInput({ className, ...props }: Omit<InputProps, "type">) {
  const labels = useUiLabels();
  const [visible, setVisible] = useState(false);
  return (
    <div data-password-field="" className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={classNames("pr-12", className)} />
      <span className="absolute inset-y-0 right-1 flex items-center">
        <IconButton
          label={visible ? labels.hidePassword : labels.showPassword}
          icon={visible ? EyeOff : Eye}
          size="md"
          tooltip={false}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        />
      </span>
    </div>
  );
}

export interface TextareaProps extends ComponentProps<"textarea"> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, rows = 4, ...props }: TextareaProps) {
  const field = useFieldControl();
  return (
    <textarea
      {...field}
      {...(invalid ? { "aria-invalid": true } : {})}
      rows={rows}
      className={classNames(controlClassName, "py-2", className)}
      {...props}
    />
  );
}
