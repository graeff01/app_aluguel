import { contactLinks } from "@/lib/phone";
import { cx } from "./ui";

function WhatsIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12.04 2a9.9 9.9 0 0 0-8.45 15.06L2.5 21.5l4.55-1.07A9.9 9.9 0 1 0 12.04 2Zm0 18.13a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-2.7.64.72-2.63-.2-.31a8.22 8.22 0 1 1 6.66 3.62Zm4.5-6.15c-.25-.12-1.46-.72-1.69-.8-.23-.08-.39-.12-.55.12-.17.25-.64.8-.78.97-.14.16-.29.18-.53.06a6.7 6.7 0 0 1-3.34-2.92c-.25-.43.25-.4.72-1.34.08-.16.04-.3-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3 2.74 2.74 0 0 0-.86 2.04c0 1.2.88 2.37 1 2.53.12.16 1.73 2.64 4.19 3.7 1.56.67 2.17.73 2.95.61.47-.07 1.46-.6 1.67-1.18.2-.58.2-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}
function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

/** Ligar (azul) / WhatsApp (verde): tons suaves com ícone escuro para manter contraste. Só abrem o contato. */
export function ContactButtons({ phone, name, compact, className }: { phone: string | null | undefined; name?: string | null; compact?: boolean; className?: string }) {
  const links = contactLinks(phone);
  if (!links) return null;
  const who = name ? ` para ${name}` : "";
  const shape = compact ? "relative z-[1] grid size-11 place-items-center rounded-full" : "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold";
  return (
    <div className={cx("flex gap-2", className)}>
      <a href={links.tel} className={cx(shape, "press bg-[#e8f0fe] text-[#1a56c4] ring-1 ring-[#1a56c4]/10 hover:bg-[#dbe7fd]")} aria-label={`Ligar${who}`}>
        <PhoneIcon className="size-[19px]" />
        {!compact && "Ligar"}
      </a>
      <a
        href={links.whatsapp}
        target="_blank"
        rel="noopener noreferrer"
        className={cx(shape, "press bg-[#e3f7eb] text-[#0f7a3c] ring-1 ring-[#0f7a3c]/10 hover:bg-[#d3f2df]")}
        aria-label={`Abrir WhatsApp${who}`}
      >
        <WhatsIcon className="size-[21px]" />
        {!compact && "WhatsApp"}
      </a>
    </div>
  );
}
