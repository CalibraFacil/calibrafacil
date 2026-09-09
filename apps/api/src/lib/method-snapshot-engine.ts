import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { calibrationMethod, type MethodSnapshot } from "@calibra-facil/db/schema";
import {
  reconcileCompiledMethodEngine,
  type CalculationEngineLike,
} from "@calibra-facil/method-definition";

import { isCompiledMethod } from "../modules/jobs/helpers";

/**
 * Re-point a job's frozen method snapshot at the method's current compilation
 * when — and only when — the engine contract changed underneath it.
 *
 * A job freezes its own copy of the compiled method when it is created, so
 * recompiling and re-approving a published method after an engine release does
 * not reach jobs that are already open: their snapshots would stay on the old
 * engine and `executeCompiledMethod` would refuse to run them forever (review
 * of the 0.4.0 execution guard). Adoption is gated on the compiled method
 * itself: `reconcileCompiledMethodEngine` only accepts a current compilation
 * whose normalized method definition (engine block removed) is byte-identical,
 * which proves the method's metrology did not move — only the engine it was
 * compiled with. Anything else is left to the guard, which is the correct
 * outcome: a method that really changed must not be swapped under a job in
 * flight.
 */
export async function reconcileMethodSnapshotEngine(params: {
  methodSnapshot: MethodSnapshot;
  organizationId: string;
  engine: CalculationEngineLike;
}): Promise<{ methodSnapshot: MethodSnapshot; adopted: boolean }> {
  const { methodSnapshot, organizationId, engine } = params;
  const snapshotCompiled = methodSnapshot.compiledMethod;
  if (!isCompiledMethod(snapshotCompiled)) {
    return { methodSnapshot, adopted: false };
  }

  const [current] = await db
    .select({
      compiledMethod: calibrationMethod.compiledMethod,
      methodFingerprint: calibrationMethod.methodFingerprint,
      methodEngine: calibrationMethod.methodEngine,
      publicationEvidence: calibrationMethod.publicationEvidence,
    })
    .from(calibrationMethod)
    .where(
      and(
        eq(calibrationMethod.id, methodSnapshot.methodId),
        eq(calibrationMethod.organizationId, organizationId),
        // The very version the job pinned: a newer version is a different
        // method for the purposes of an open job.
        eq(calibrationMethod.version, methodSnapshot.methodVersion),
      ),
    )
    .limit(1);

  const currentCompiled = current?.compiledMethod;
  const reconciled = reconcileCompiledMethodEngine({
    snapshot: snapshotCompiled,
    current: isCompiledMethod(currentCompiled) ? currentCompiled : null,
    engine,
  });
  if (!reconciled.adopted) return { methodSnapshot, adopted: false };

  const adopted = reconciled.compiledMethod;
  return {
    adopted: true,
    methodSnapshot: {
      ...methodSnapshot,
      compiledMethod: adopted,
      methodFingerprint: adopted.methodFingerprint,
      engineVersion: adopted.engine.version,
      engineOptionsFingerprint: adopted.engine.optionsFingerprint,
      normalizedMethodJson: adopted.normalizedMethodJson,
      // The publication evidence of the compilation actually executed: the
      // snapshot's old evidence covers a fingerprint that is no longer the one
      // being run.
      ...(current?.publicationEvidence === undefined
        ? {}
        : { publicationEvidence: current.publicationEvidence }),
    },
  };
}
