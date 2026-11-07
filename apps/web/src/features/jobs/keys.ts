/** Query keys of the jobs (calibrations) feature. See `assets/keys.ts`. */
export type JobListKeyInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: string
}

export const jobKeys = {
  /** Every job list, detail and sub-resource. */
  all: ['jobs'] as const,
  list: (input: JobListKeyInput) =>
    [
      'jobs',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ] as const,
  listScope: (organizationId: string) => ['jobs', organizationId] as const,
  detail: (id: string | number) => ['jobs', id] as const,
  label: (id: string | number) => ['jobs', id, 'label'] as const,
  certificateDownloadUrl: (jobId: string | number, certificateUrl: unknown) =>
    ['jobs', jobId, 'certificate-download-url', certificateUrl] as const,
  technicians: ['jobs', 'technicians'] as const,
  /** Technicians of an organization (request conversion). */
  organizationTechnicians: (organizationId: string) =>
    ['jobs', organizationId, 'technicians'] as const,
  /** Jobs a non-conformance can be raised against. */
  forNonConformance: ['jobs-for-nc'] as const,
}
