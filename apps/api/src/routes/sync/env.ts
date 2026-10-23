import { type R2Env } from "../../lib/storage";
import {
  type AuthVariables,
  type MemberData,
} from "../../middleware/permission";

export function getMemberData(c: { get: (key: "member") => MemberData }) {
  return c.get("member");
}

export type SyncRouterEnv = {
  Variables: AuthVariables;
  Bindings: R2Env;
};
