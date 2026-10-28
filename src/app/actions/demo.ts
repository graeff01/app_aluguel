"use server";
import { toState, str, type ActionState } from "@/lib/action";
import { clientIp } from "@/lib/session";
import { submitDemoFeedback } from "@/server/demo-capture";

/** Sugestão da demonstração pública (sem login). */
export async function demoFeedbackAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await submitDemoFeedback({ demo: str(fd, "demo") || "captacao", name: str(fd, "name"), text: str(fd, "text"), ip: await clientIp() });
    return { ok: true, message: "Obrigado! Sua sugestão chegou para a equipe.", at: Date.now() };
  } catch (e) {
    return toState(e);
  }
}
