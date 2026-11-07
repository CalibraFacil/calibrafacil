import path from "node:path";
import { LocalDomainError } from "@calibra-facil/local-db";

/**
 * The absolute path of a file kept under the local storage root, refusing any
 * path that leaves it. The attachment endpoints and the sync upload leg both
 * read attachment files through this.
 */
export function resolveLocalStoragePath(
  storageRoot: string,
  localPath: string,
) {
  const root = path.resolve(storageRoot);
  const target = path.resolve(root, localPath);

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new LocalDomainError("Caminho de arquivo local invalido");
  }

  return target;
}
