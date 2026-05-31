// TSPL text is double-quoted, and commands are newline-delimited. Strip CR/LF
// and neutralize quotes/backslashes so field data can't break out of a string
// or inject a command. Accents pass through as UTF-8 (the renderer sets
// `CODEPAGE UTF-8`). Our real data (asset tag, lab name, dates, verify URL)
// never contains these characters, so this is effectively a pass-through.
export function escapeTsplText(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .replace(/\\/g, "/");
}
