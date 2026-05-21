import {
  cloneElement,
  isValidElement,
  useId,
  type ReactNode,
} from 'react'

import { Label } from '@/components/ui/label'

type FormFieldControlProps = {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

export function FormField({
  id,
  label,
  description,
  error,
  children,
}: {
  id?: string
  label: string
  description?: ReactNode
  error?: ReactNode
  children: ReactNode
}) {
  const generatedId = useId()
  const controlId = id ?? `field-${generatedId}`
  const descriptionId = description ? `${controlId}-description` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ')

  return (
    <div className="space-y-2">
      <Label htmlFor={controlId}>{label}</Label>
      {withControlA11y(children, {
        id: controlId,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function withControlA11y(children: ReactNode, props: FormFieldControlProps) {
  if (!isValidElement<FormFieldControlProps>(children)) {
    return children
  }

  const child = children

  return cloneElement(child, {
    id: child.props.id ?? props.id,
    'aria-describedby':
      child.props['aria-describedby'] ?? props['aria-describedby'],
    'aria-invalid': child.props['aria-invalid'] ?? props['aria-invalid'],
  })
}
