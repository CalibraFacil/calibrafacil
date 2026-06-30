import {
  CreateCustomerSchema,
  type CreateCustomerInput,
} from '@calibra-facil/schemas'

import {
  zodFormError,
  type FeatureFormValidationResult,
} from '@/shared/forms/validation'

export type CustomerFormData = {
  name: string
  tradeName: string
  taxId: string
  email: string
  phone: string
  address: CustomerAddressFormData
}

export type CustomerAddressFormData = {
  cep: string
  street: string
  number: string
  complement: string
  neighbourhood: string
  city: string
  state: string
}

export type CustomerFormField = keyof CustomerFormData

export function parseCustomerForm(
  data: CustomerFormData,
): FeatureFormValidationResult<CreateCustomerInput, CustomerFormField> {
  const fieldErrors: Array<{ field: CustomerFormField; message: string }> = []
  const name = data.name.trim()
  const email = optionalText(data.email)
  const address = parseAddress(data.address)

  if (!name) {
    appendFieldError(fieldErrors, {
      field: 'name',
      message: 'Informe o nome ou razão social do cliente.',
    })
  }

  const parsed = CreateCustomerSchema.safeParse({
    name: name || 'Cliente',
    ...(optionalText(data.tradeName)
      ? { tradeName: optionalText(data.tradeName) }
      : {}),
    ...(optionalText(data.taxId) ? { taxId: optionalText(data.taxId) } : {}),
    ...(email ? { email } : {}),
    ...(optionalText(data.phone) ? { phone: optionalText(data.phone) } : {}),
    ...(address ? { address } : {}),
  })

  if (!parsed.success) {
    const schemaErrors = zodFormError(parsed.error.issues, [
      'name',
      'tradeName',
      'taxId',
      'email',
      'phone',
      'address',
    ])
    if (!schemaErrors.success) {
      for (const error of schemaErrors.fieldErrors) {
        appendFieldError(fieldErrors, mapCustomerSchemaError(error))
      }
    }
  }

  if (fieldErrors.length > 0) {
    return {
      success: false,
      message: fieldErrors[0]?.message ?? 'Dados inválidos',
      fieldErrors,
    }
  }

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos',
      fieldErrors,
    }
  }

  return { success: true, data: parsed.data }
}

function parseAddress(address: CustomerAddressFormData) {
  const parsed = {
    cep: optionalText(address.cep),
    street: optionalText(address.street),
    number: optionalText(address.number),
    complement: optionalText(address.complement),
    neighbourhood: optionalText(address.neighbourhood),
    city: optionalText(address.city),
    state: optionalText(address.state),
  }

  if (!Object.values(parsed).some(Boolean)) {
    return undefined
  }

  return parsed
}

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function appendFieldError<TField extends string>(
  errors: Array<{ field: TField; message: string }>,
  error: { field: TField; message: string },
) {
  if (errors.some((item) => item.field === error.field)) {
    return
  }

  errors.push(error)
}

function mapCustomerSchemaError(error: {
  field: CustomerFormField
  message: string
}) {
  if (error.field === 'email') {
    return {
      ...error,
      message: 'Revise o endereço de email antes de enviar o convite.',
    }
  }

  return error
}
