import { cloneElement, isValidElement, useId, useMemo } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";
import { Label } from "./label";
import { Separator } from "./separator";

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "gap-6 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3 flex flex-col",
        className,
      )}
      {...props}
    />
  );
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "mb-3 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base",
        className,
      )}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "gap-7 data-[slot=checkbox-group]:gap-3 [&>[data-slot=field-group]]:gap-4 group/field-group @container/field-group flex w-full flex-col",
        className,
      )}
      {...props}
    />
  );
}

const fieldVariants = cva(
  "data-[invalid=true]:text-destructive gap-3 group/field flex w-full",
  {
    variants: {
      orientation: {
        vertical: "flex-col [&>*]:w-full [&>.sr-only]:w-auto",
        horizontal:
          "flex-row items-center [&>[data-slot=field-label]]:flex-auto has-[>[data-slot=field-content]]:items-start has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
        responsive:
          "flex-col [&>*]:w-full [&>.sr-only]:w-auto @md/field-group:flex-row @md/field-group:items-center @md/field-group:[&>*]:w-auto @md/field-group:[&>[data-slot=field-label]]:flex-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  },
);

type FieldRootProps = React.ComponentProps<"div"> &
  VariantProps<typeof fieldVariants>;

type FieldControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * Labelled mode: pass `label` (and optionally `description` / `error`) and the
 * Field wires the control for you — the label's `htmlFor`, the control's `id`,
 * `aria-describedby` pointing at the description and error, `aria-invalid`
 * while there is an error, and an error that is announced (`role="alert"`).
 * The control is the single child element; an `id`, `aria-describedby` or
 * `aria-invalid` it already carries wins.
 */
type LabelledFieldProps = Omit<FieldRootProps, "children"> & {
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
};

/** Composable mode: the shadcn parts (`FieldLabel`, `FieldError`, ...) as children. */
type ComposableFieldProps = FieldRootProps & {
  label?: never;
  description?: never;
  error?: never;
};

type FieldProps = LabelledFieldProps | ComposableFieldProps;

function Field(props: FieldProps) {
  const generatedId = useId();

  if (props.label === undefined) {
    const { className, orientation = "vertical", ...rest } = props;
    return (
      <div
        role="group"
        data-slot="field"
        data-orientation={orientation}
        className={cn(fieldVariants({ orientation }), className)}
        {...rest}
      />
    );
  }

  const {
    className,
    orientation = "vertical",
    id,
    label,
    description,
    error,
    children,
    ...rest
  } = props;
  // The label must point at the id the control really ends up with, so an id
  // already on the control wins over the generated one.
  const ownId = isValidElement<FieldControlProps>(children)
    ? children.props.id
    : undefined;
  const controlId = id ?? ownId ?? `field-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ");

  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      data-invalid={error ? true : undefined}
      className={cn(fieldVariants({ orientation }), className)}
      {...rest}
    >
      <FieldLabel htmlFor={controlId}>{label}</FieldLabel>
      {withControlA11y(children, {
        id: controlId,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {description ? (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

function withControlA11y(children: React.ReactNode, props: FieldControlProps) {
  if (!isValidElement<FieldControlProps>(children)) {
    return children;
  }

  return cloneElement(children, {
    id: children.props.id ?? props.id,
    "aria-describedby":
      children.props["aria-describedby"] ?? props["aria-describedby"],
    "aria-invalid": children.props["aria-invalid"] ?? props["aria-invalid"],
  });
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn(
        "gap-1 group/field-content flex flex-1 flex-col leading-snug",
        className,
      )}
      {...props}
    />
  );
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "has-data-checked:bg-primary/5 has-data-checked:border-primary dark:has-data-checked:bg-primary/10 gap-2 group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border [&>*]:data-[slot=field]:p-3 group/field-label peer/field-label flex w-fit leading-snug",
        "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "gap-2 text-sm font-medium group-data-[disabled=true]/field:opacity-50 flex w-fit items-center leading-snug",
        className,
      )}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-muted-foreground text-left text-sm [[data-variant=legend]+&]:-mt-1.5 leading-normal font-normal group-has-[[data-orientation=horizontal]]/field:text-balance",
        "last:mt-0 nth-last-2:-mt-1",
        "[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4",
        className,
      )}
      {...props}
    />
  );
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode;
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        "-my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2 relative",
        className,
      )}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="text-muted-foreground px-2 bg-background relative mx-auto block w-fit"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  );
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>;
}) {
  const content = useMemo(() => {
    if (children) {
      return children;
    }

    if (!errors?.length) {
      return null;
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ];

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message;
    }

    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>,
        )}
      </ul>
    );
  }, [children, errors]);

  if (!content) {
    return null;
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("text-destructive text-sm font-normal", className)}
      {...props}
    >
      {content}
    </div>
  );
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
};
