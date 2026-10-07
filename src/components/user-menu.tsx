import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { Avatar } from "./ui";
import { Icon } from "./icons";
import { PushToggle } from "./push-toggle";

/** Menu do usuário no cabeçalho (sem JS: <details>). */
export function UserMenu({ name, email, role, showProfile, pushKey }: { name: string; email: string; role: string; showProfile: boolean; pushKey: string | null }) {
  return (
    <details className="relative">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full py-1 pr-1 pl-1 hover:bg-tint md:pr-3" aria-label="Menu da conta">
        <Avatar name={name} size="sm" />
        <span className="hidden text-sm font-semibold md:inline">{name.split(" ")[0]}</span>
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-64 rounded-2xl border border-line bg-surface p-2 shadow-float">
        <div className="border-b border-line px-3 pt-2 pb-3">
          <p className="font-semibold">{name}</p>
          <p className="truncate text-[13px] text-ink-3">{email}</p>
          <p className="mt-1 text-[12px] font-semibold tracking-wide text-accent-strong uppercase">{ROLE_LABEL[role]}</p>
        </div>
        <PushToggle publicKey={pushKey} />
        {showProfile && (
          <Link href="/perfil" className="mt-1 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-tint">
            <Icon name="user" className="size-[18px] text-ink-3" /> Perfil e senha
          </Link>
        )}
        <form action={logoutAction}>
          <button className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-bad hover:bg-bad-soft">
            <Icon name="logout" className="size-[18px]" /> Sair
          </button>
        </form>
      </div>
    </details>
  );
}
