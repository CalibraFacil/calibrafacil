/** Query keys of the notifications feature. See `assets/keys.ts`. */
export const notificationKeys = {
  all: ['notifications'] as const,
  /** Everything cached for one organization's notifications. */
  organization: (organizationKey: string) =>
    ['notifications', organizationKey] as const,
  unreadCount: (organizationKey: string) =>
    ['notifications', organizationKey, 'unread-count'] as const,
  inbox: (
    organizationKey: string,
    view: { page: number; unreadOnly: boolean },
  ) =>
    [
      'notifications',
      organizationKey,
      'inbox',
      { page: view.page, unreadOnly: view.unreadOnly },
    ] as const,
  desktopBridge: (organizationKey: string) =>
    ['notifications', organizationKey, 'desktop-bridge'] as const,
}
