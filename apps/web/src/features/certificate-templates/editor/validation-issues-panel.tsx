import { describeIssueLocation, type ValidationIssue } from './forms'

/** Server validation issues, mapped to the offending block (spec 02 §6.2). */
export function ValidationIssuesPanel({
  issues,
  documentJson,
}: {
  issues: ValidationIssue[]
  documentJson: Record<string, unknown>
}) {
  if (issues.length === 0) return null
  return (
    <div
      className="space-y-1.5 rounded-xl border border-destructive/40 bg-destructive/5 p-3"
      role="alert"
      data-testid="validation-issues"
    >
      <h2 className="text-sm font-semibold text-destructive">
        Problemas de validação ({issues.length})
      </h2>
      <ul className="space-y-1 text-xs">
        {issues.map((issue, index) => {
          const location = describeIssueLocation(documentJson, issue.path)
          return (
            <li key={`${issue.path}-${index}`} className="flex gap-1.5">
              {location && (
                <span className="shrink-0 font-medium">{location}:</span>
              )}
              <span>{issue.message}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
