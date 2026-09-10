/**
 * Whether the signed-in identity was confirmed against the cloud *just now*.
 *
 * This is the input the host's partition guard trusts, so it has to mean
 * exactly one thing: the server was reached and it said this session is valid.
 * A session restored from Better Auth's cookie cache does not qualify — it
 * reports what the browser last saw, not whether the membership still exists
 * or the role still applies.
 *
 * `disableCookieCache: true` is what forces the round trip; per Better Auth's
 * documentation it "will force the server to fetch the session from the
 * database and also refresh the cookie cache".
 *
 * Every failure mode resolves to *unverified*. Being wrong in that direction
 * costs a sign-in; being wrong in the other opens one account's offline
 * calibration records to another.
 */

export type VerifiedIdentity = {
  userId: string | null
  /**
   * The organization the *server* says this session is currently acting in.
   * Membership proof: a partition may only be opened for the organization the
   * cloud itself reports, never one the renderer merely asked for.
   */
  activeOrganizationId: string | null
  /** True only when the cloud confirmed the session in this attempt. */
  verified: boolean
}

export type SessionReadResult = {
  data?: {
    user?: { id?: string | null } | null
    session?: { activeOrganizationId?: string | null } | null
  } | null
  error?: unknown
}

export type UncachedSessionReader = () => Promise<SessionReadResult>

export async function verifyCloudIdentity(
  readUncachedSession: UncachedSessionReader,
): Promise<VerifiedIdentity> {
  try {
    const result = await readUncachedSession()

    // An `error` alongside data still means the server did not affirm this
    // session; treat it as unverified rather than reading around it.
    if (result.error) return unverified()

    const userId = result.data?.user?.id ?? null
    if (!userId) return unverified()

    return {
      userId,
      activeOrganizationId: result.data?.session?.activeOrganizationId ?? null,
      verified: true,
    }
  } catch {
    // Offline, DNS failure, proxy down, timeout — all the same answer.
    return unverified()
  }
}

function unverified(): VerifiedIdentity {
  return { userId: null, activeOrganizationId: null, verified: false }
}

/**
 * Whether a verified session actually authorizes *this* partition.
 *
 * The boolean alone is not enough. The requested account and organization come
 * from renderer state that can be stale mid-switch, so a cloud response
 * confirming account B could otherwise authorize opening account A's database
 * — and nothing would have checked membership in the requested organization at
 * all.
 */
export function verificationAuthorizes(
  identity: VerifiedIdentity,
  requested: { userId: string; organizationId: string },
): boolean {
  if (!identity.verified) return false
  if (identity.userId !== requested.userId) return false

  return identity.activeOrganizationId === requested.organizationId
}
