import type { MaskitoOptions } from '@maskito/core'

const digit = /\d/
const optionalDigit = /\d?/

export const cepMask: MaskitoOptions = {
  mask: [digit, digit, digit, digit, digit, '-', digit, digit, digit],
}

export const cnpjMask: MaskitoOptions = {
  mask: [
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
  ],
}

export const cpfCnpjMask: MaskitoOptions = {
  mask: ({ value }) =>
    value.replace(/\D/g, '').length > 11
      ? cnpjMask.mask
      : [
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
        ],
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
