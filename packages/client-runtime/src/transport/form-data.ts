export function appendNamedBlob(
  formData: FormData,
  name: string,
  file: Blob,
  fileName: string | undefined,
) {
  if (fileName) {
    formData.append(name, file, fileName);
    return;
  }

  formData.append(name, file);
}
