import type { MaskitoMaskExpression, MaskitoOptions } from '@maskito/core'

const digit = /\d/
const optionalDigit = /\d?/
const cnpjMaskPattern: MaskitoMaskExpression = [
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
  '/',
  digit,
  digit,
  digit,
  digit,
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

export const cepMask: MaskitoOptions = {
  mask: [digit, digit, digit, digit, digit, '-', digit, digit, digit],
}

export const cnpjMask: MaskitoOptions = {
  mask: cnpjMaskPattern,
}

export const cpfCnpjMask: MaskitoOptions = {
  mask: ({ value }) =>
    value.replace(/\D/g, '').length > 11 ? cnpjMaskPattern : cpfMaskPattern,
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
