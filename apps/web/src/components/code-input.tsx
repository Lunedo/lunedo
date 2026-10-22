import { OneTimeCodeInput } from "@lunedo/ui";
import { type Control, Controller, type FieldValues, type Path } from "react-hook-form";

export function CodeInput<TInput extends FieldValues, TOutput>({
  control,
  name,
  autoFocus = false,
}: {
  control: Control<TInput, unknown, TOutput>;
  name: Path<TInput>;
  autoFocus?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <OneTimeCodeInput
          ref={field.ref}
          name={field.name}
          value={typeof field.value === "string" ? field.value : ""}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          autoFocus={autoFocus}
        />
      )}
    />
  );
}
