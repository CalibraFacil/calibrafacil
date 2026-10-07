import { expect } from '@playwright/test'

const mailpitURL = process.env.STACK_MAILPIT_URL ?? 'http://localhost:8025'

type MailpitSearch = {
  messages?: Array<{ ID: string; Created: string }>
}

type MailpitMessage = { HTML?: string; Text?: string }

function isSearch(value: unknown): value is MailpitSearch {
  return typeof value === 'object' && value !== null
}

function isMessage(value: unknown): value is MailpitMessage {
  return typeof value === 'object' && value !== null
}

/**
 * The sign-in link e-mailed to `address` after `since`, read from the local
 * Mailpit inbox the stack sends every message to.
 */
export async function signInLinkFor(
  address: string,
  since: Date,
): Promise<string> {
  let link: string | undefined
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${address}"`)
        const search: unknown = await fetch(
          `${mailpitURL}/api/v1/search?query=${query}&limit=5`,
        ).then((response) => response.json())
        const newest = (isSearch(search) ? (search.messages ?? []) : []).find(
          (message) => new Date(message.Created) >= since,
        )
        if (!newest) return undefined
        const message: unknown = await fetch(
          `${mailpitURL}/api/v1/message/${newest.ID}`,
        ).then((response) => response.json())
        const body = isMessage(message)
          ? `${message.Text ?? ''} ${message.HTML ?? ''}`
          : ''
        link = body
          .match(/https?:\/\/[^\s"'<>]*\/magic-link\?[^\s"'<>]+/)?.[0]
          ?.replaceAll('&amp;', '&')
        return link
      },
      { message: `sign-in e-mail for ${address}`, timeout: 30_000 },
    )
    .toBeTruthy()
  if (!link) throw new Error(`No sign-in link for ${address}`)
  return link
}
