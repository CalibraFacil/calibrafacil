export function pageFromUrl(url?: URL) {
  const page = Number(url?.searchParams.get('page') ?? 1)
  return Number.isFinite(page) && page > 0 ? page : 1
}

export function optionFromUrl<TValue extends string>(
  values: readonly TValue[],
  value: string | null | undefined,
): TValue | '' {
  if (!value) return ''

  for (const candidate of values) {
    if (candidate === value) {
      return candidate
    }
  }

  return ''
}
