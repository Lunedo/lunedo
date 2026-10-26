import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, useContext, useId, useState } from "react";
import { IconButton } from "./button.js";
import { classNames } from "./class-names.js";
import { SettingHelp } from "./help-popover.js";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export type FieldLayout = "stacked" | "row";

const FieldLayoutContext = createContext<FieldLayout>("stacked");

export function FieldLayoutProvider({ layout, children }: { layout: FieldLayout; children: ReactNode }) {
  return <FieldLayoutContext.Provider value={layout}>{children}</FieldLayoutContext.Provider>;
}

export function useFieldLayout(): FieldLayout {
  return useContext(FieldLayoutContext);
}

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
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  id?: string;
  labelAction?: ReactNode;
  children: ReactNode;
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" tabIndex={-1} data-field-error="" className="text-sm text-danger">
      <Icon icon={CircleAlert} size="sm" className="mr-1 inline align-text-bottom" />
      {children}
    </p>
  );
}

export function Field({ label, hint, help, error, required = false, id, labelAction, children }: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field-${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const layout = useFieldLayout();
  const errorLine = error && (
    <p id={errorId} className="text-sm text-danger">
      <Icon icon={CircleAlert} size="sm" className="mr-1 inline align-text-bottom" />
      {error}
    </p>
  );
  if (layout === "row") {
    return (
      <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error), required }}>
        <div
          data-setting-row=""
          data-field-row=""
          className="grid grid-cols-1 items-center gap-x-4 gap-y-2 py-3 sm:grid-cols-setting-row"
        >
          <div data-setting-label="" className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-1">
              <label htmlFor={controlId} className="font-medium text-text">
                {label}
              </label>
              {help ? <SettingHelp subject={label}>{help}</SettingHelp> : null}
            </div>
            {hint && (
              <p id={hintId} data-setting-hint="" className="text-sm text-text-muted">
                {hint}
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-3">
              <div data-setting-control="" className="flex min-w-0 flex-1 flex-col sm:max-w-card">
                <FieldLayoutProvider layout="stacked">{children}</FieldLayoutProvider>
              </div>
              {labelAction && <div className="flex shrink-0 items-center">{labelAction}</div>}
            </div>
            {errorLine}
          </div>
        </div>
      </FieldContext.Provider>
    );
  }
  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error), required }}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <label htmlFor={controlId} className="font-medium text-text">
              {label}
            </label>
            {help ? <SettingHelp subject={label}>{help}</SettingHelp> : null}
          </div>
          {labelAction}
        </div>
        {children}
        {errorLine}
        {hint && (
          <p id={hintId} className="text-sm text-text-muted">
            {hint}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

export function controlWidth(className: string | undefined): string {
  return className && /(^|s)w-/.test(className) ? controlClassName.replace("w-full ", "") : controlClassName;
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
      className={classNames(controlWidth(className), "h-control-field", className)}
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

export function FieldGrid({
  columns = 2,
  className,
  children,
}: {
  columns?: 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  const layout = useFieldLayout();
  if (layout === "row") return <>{children}</>;
  return (
    <div
      data-field-grid=""
      className={classNames("grid gap-4", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2", className)}
    >
      {children}
    </div>
  );
}

export function FieldGridItem({ span, children }: { span: 2; children: ReactNode }) {
  const layout = useFieldLayout();
  if (layout === "row") return <>{children}</>;
  return <div className={span === 2 ? "sm:col-span-2" : undefined}>{children}</div>;
}

export function InlineField({ children }: { children: ReactNode }) {
  return (
    <FieldLayoutProvider layout="stacked">
      <div data-inline-field="" className="w-field max-w-full">
        {children}
      </div>
    </FieldLayoutProvider>
  );
}
