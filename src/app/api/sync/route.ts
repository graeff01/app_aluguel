import type { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api";
import { assert, canTriggerSync } from "@/lib/authz";
import { requestManualSync } from "@/server/sync/runner";
import { AppError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  return apiHandler(req, async (actor) => {
    assert(canTriggerSync(actor));
    const r = await requestManualSync(actor.id);
    if (!r.created && "retryAfterSeconds" in r && r.retryAfterSeconds) {
      throw new AppError("RATE_LIMITED", `Aguarde ${r.retryAfterSeconds} s para sincronizar novamente.`);
    }
    return { ok: true, runId: r.run.id, status: r.run.status, created: r.created };
  });
}
