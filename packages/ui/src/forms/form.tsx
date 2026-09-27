import type { BooleanFieldProps as BaseBooleanFieldProps } from "./boolean-field";
import type { NumberFieldProps as BaseNumberFieldProps } from "./number-field";
import type { SelectFieldProps as BaseSelectFieldProps } from "./select-field";
import type { TextFieldProps as BaseTextFieldProps } from "./text-field";
import type { ReactNode } from "react";

import { useState } from "react";

import { createFormHook, createFormHookContexts, formOptions } from "@tanstack/react-form";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { BooleanField as BaseBooleanField } from "./boolean-field";
import { formatFieldErrors } from "./field-errors";
import { NumberField as BaseNumberField } from "./number-field";
import { SelectField as BaseSelectField } from "./select-field";
import { TextField as BaseTextField } from "./text-field";
import { Field, FieldDescription, FieldError, FieldLabel } from "../components/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/tooltip";
import { Button } from "../components/button";
import type { ButtonProps } from "../components/button";
import { cn } from "@tailorkit/ui";

export { formOptions };
export { formatFieldErrors } from "./field-errors";

// export useFieldContext for use in your custom components
export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export type TextFieldProps = Omit<BaseTextFieldProps, "errors" | "value">;

export function TextField({ onBlur, onChange, ...props }: TextFieldProps) {
  const field = useFieldContext<string>();

  return (
    <BaseTextField
      {...props}
      errors={field.state.meta.errors}
      onBlur={(event) => {
        field.handleBlur();
        onBlur?.(event);
      }}
      onChange={(event) => {
        field.handleChange(event.target.value);
        onChange?.(event);
      }}
      value={field.state.value}
    />
  );
}

export type NumberFieldProps = Omit<BaseNumberFieldProps, "errors" | "value">;

export function NumberField({ onBlur, onChange, ...props }: NumberFieldProps) {
  const field = useFieldContext<number | null>();

  return (
    <BaseNumberField
      {...props}
      errors={field.state.meta.errors}
      onBlur={(event) => {
        field.handleBlur();
        onBlur?.(event);
      }}
      onChange={(
        value: number | null,
        eventDetails: Parameters<NonNullable<BaseNumberFieldProps["onChange"]>>[1],
      ) => {
        field.handleChange(value);
        onChange?.(value, eventDetails);
      }}
      value={typeof field.state.value === "number" ? field.state.value : null}
    />
  );
}

export type SelectFieldProps = Omit<BaseSelectFieldProps, "errors" | "value">;

export function SelectField(props: SelectFieldProps) {
  const field = useFieldContext<string>();
  const { onValueChange, ...restProps } = props;

  return (
    <BaseSelectField
      {...restProps}
      errors={field.state.meta.errors}
      onValueChange={(value) => {
        field.setValue(value || field.state.value);
        onValueChange?.(value);
      }}
      value={field.state.value}
    />
  );
}

export interface SecretTextFieldProps {
  autoFocus?: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  labelAction?: ReactNode;
  placeholder?: string;
  required?: boolean;
}

export function SecretTextField({
  autoFocus,
  description,
  disabled,
  label,
  labelAction,
  placeholder,
  required,
}: SecretTextFieldProps) {
  const field = useFieldContext<string>();
  const [showSecret, setShowSecret] = useState(false);
  const errors = field.state.meta.errors;
  const errorMessage = formatFieldErrors(errors);
  const isError = errorMessage.length > 0;

  return (
    <Field disabled={disabled} invalid={isError}>
      <FieldLabel className={"w-full"}>
        {label} {required && <span className="text-destructive-foreground">*</span>}
        {labelAction && <div className="ml-auto">{labelAction}</div>}
      </FieldLabel>
      <InputGroup>
        <InputGroupInput
          aria-invalid={isError || undefined}
          autoFocus={autoFocus}
          disabled={disabled}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          type={showSecret ? "text" : "password"}
          value={field.state.value}
        />
        <InputGroupAddon align="inline-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={showSecret ? "Hide secret" : "Show secret"}
                  onClick={() => setShowSecret(!showSecret)}
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              {showSecret ? <EyeOffIcon /> : <EyeIcon />}
            </TooltipTrigger>
            <TooltipPopup>{showSecret ? "Hide secret" : "Show secret"}</TooltipPopup>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
      {description && <FieldDescription>{description}</FieldDescription>}
      {isError && <FieldError>{errorMessage}</FieldError>}
    </Field>
  );
}

export type BooleanFieldProps = Omit<
  BaseBooleanFieldProps,
  "checked" | "errors" | "onBlur" | "onCheckedChange"
>;

export function BooleanField(props: BooleanFieldProps) {
  const field = useFieldContext<boolean>();

  return (
    <BaseBooleanField
      {...props}
      checked={Boolean(field.state.value)}
      errors={field.state.meta.errors}
      onBlur={field.handleBlur}
      onCheckedChange={field.handleChange}
    />
  );
}

function SubmitButton({
  children,
  variant,
  className,
  ...props
}: Omit<ButtonProps, "type" | "disabled" | "loading">) {
  const form = useFormContext();
  return (
    <form.Subscribe
      selector={(state) => ({
        canSubmit: state.canSubmit,
        isSubmitting: state.isSubmitting,
        isValidating: state.isValidating,
      })}
    >
      {({
        canSubmit,
        isSubmitting,
        isValidating,
      }: {
        canSubmit: boolean;
        isSubmitting: boolean;
        isValidating: boolean;
      }) => (
        <Button
          variant={variant}
          className={cn("w-min", className)}
          type="submit"
          disabled={!canSubmit}
          loading={isSubmitting || isValidating}
          {...props}
        >
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}

function FormError({ children }: { children?: ReactNode }) {
  const errorMessage = formatFieldErrors([children]);

  if (!errorMessage) {
    return null;
  }

  return (
    <Field invalid>
      <FieldError>{errorMessage}</FieldError>
    </Field>
  );
}

export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  // We'll learn more about these options later
  fieldComponents: {
    TextField,
    NumberField,
    SelectField,
    BooleanField,
    SecretTextField,
  },
  formComponents: {
    FormError,
    SubmitButton,
  },
});
