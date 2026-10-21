// The web app runs in the browser of a Brazilian laboratory, but CI (and a
// developer's laptop) can sit in any time zone. Pin it before the test workers
// spawn so a date that shifts for a user in Sao Paulo fails everywhere.
export default function setup() {
  process.env.TZ = 'America/Sao_Paulo'
}
