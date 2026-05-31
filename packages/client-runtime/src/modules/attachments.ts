import type { AttachmentsApi } from "../types";

export function createCloudAttachmentsApi(): AttachmentsApi {
  return {
    async list() {
      return { data: [] };
    },
    async upload() {
      throw new Error("Anexos locais estão disponíveis apenas no desktop");
    },
  };
}
