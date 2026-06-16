import type {
  MaskitoMaskExpression,
  MaskitoOptions,
  MaskitoPostprocessor,
} from '@maskito/core'

const digit = /\d/
const optionalDigit = /\d?/
// CNPJ alfanumérico (live July 2026): positions 1–12 may be alphanumeric, 13–14 stay numeric.
const alnum = /[0-9a-zA-Z]/
const cnpjMaskPattern: MaskitoMaskExpression = [
  alnum,
  alnum,
  '.',
  alnum,
  alnum,
  alnum,
  '.',
  alnum,
  alnum,
  alnum,
  '/',
  alnum,
  alnum,
  alnum,
  alnum,
  '-',
  digit,
  digit,
]
const cpfMaskPattern: MaskitoMaskExpression = [
  digit,
  digit,
  digit,
  '.',
  digit,
  digit,
  digit,
  '.',
  digit,
  digit,
  digit,
  '-',
  digit,
  digit,
]

// CNPJ letters are always uppercase A–Z; uppercase whatever the user types.
const upperCase: MaskitoPostprocessor = ({ value, selection }) => ({
  value: value.toUpperCase(),
  selection,
})

export const cepMask: MaskitoOptions = {
  mask: [digit, digit, digit, digit, digit, '-', digit, digit, digit],
}

export const cnpjMask: MaskitoOptions = {
  mask: cnpjMaskPattern,
  postprocessors: [upperCase],
}

export const cpfCnpjMask: MaskitoOptions = {
  // Any letter ⇒ CNPJ (CPF is numeric-only); otherwise switch by digit count.
  mask: ({ value }) => {
    const raw = value.replace(/[^0-9a-zA-Z]/g, '')
    return /[a-zA-Z]/.test(raw) || raw.length > 11
      ? cnpjMaskPattern
      : cpfMaskPattern
  },
  postprocessors: [upperCase],
}

export const brazilPhoneMask: MaskitoOptions = {
  mask: ({ value }) =>
    value.replace(/\D/g, '').length > 10
      ? [
          '(',
          digit,
          digit,
          ')',
          ' ',
          digit,
          digit,
          digit,
          digit,
          digit,
          '-',
          digit,
          digit,
          digit,
          digit,
        ]
      : [
          '(',
          digit,
          digit,
          ')',
          ' ',
          digit,
          digit,
          digit,
          digit,
          '-',
          digit,
          digit,
          digit,
          digit,
          optionalDigit,
        ],
}
