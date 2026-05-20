export function apiRouteParam(value: string | number): string {
  let decodedValue = String(value);

  for (let index = 0; index < 3; index += 1) {
    try {
      const nextValue = decodeURIComponent(decodedValue);
      if (nextValue === decodedValue) break;
      decodedValue = nextValue;
    } catch {
      break;
    }
  }

  return encodeURIComponent(encodeURIComponent(decodedValue));
}
