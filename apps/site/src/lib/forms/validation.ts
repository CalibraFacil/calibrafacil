export type FeatureFormValidationResult<TData, TField extends string> =
  | { success: true; data: TData }
  | {
      success: false;
      message: string;
      fieldErrors: Array<{ field: TField; message: string }>;
    };

export function zodFormError<TField extends string>(
  issues: Array<{ path: Array<PropertyKey>; message: string }>,
  fields: readonly TField[],
): FeatureFormValidationResult<never, TField> {
  const fieldErrors = issues.flatMap((issue) => {
    const pathField = issue.path[0];
    if (typeof pathField !== "string") return [];
    const field = fields.find((candidate) => candidate === pathField);
    if (!field) return [];
    return [{ field, message: issue.message }];
  });

  return {
    success: false,
    message: issues[0]?.message ?? "Dados inválidos",
    fieldErrors,
  };
}
