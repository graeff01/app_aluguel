import { contactLinks } from "@/lib/phone";
import { cx } from "./ui";

function WhatsIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3.5 20.5l1.3-4A8.5 8.5 0 1 1 8 19.6l-4.5.9Z" />
      <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-1.8-.9-.9.8a4 4 0 0 1-2.4-2.4l.8-.9-.9-1.8L9 9.5Z" />
    </svg>
  );
}
function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

/** Ligar / WhatsApp para o cliente. `compact` = botões redondos (cards). */
export function ContactButtons({ phone, name, compact, className }: { phone: string | null | undefined; name?: string | null; compact?: boolean; className?: string }) {
  const links = contactLinks(phone);
  if (!links) return null;
  const who = name ? ` para ${name}` : "";
  const base = compact
    ? "relative z-[1] grid size-10 place-items-center rounded-full border border-line-strong bg-surface text-ink-2 transition hover:border-ink-3 hover:text-ink"
    : "inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-sm font-semibold transition hover:border-ink-3";
  return (
    <div className={cx("flex gap-2", className)}>
      <a href={links.tel} className={base} aria-label={`Ligar${who}`}>
        <PhoneIcon className="size-[18px]" />
        {!compact && "Ligar"}
      </a>
      <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" className={base} aria-label={`Abrir WhatsApp${who}`}>
        <WhatsIcon className="size-[18px]" />
        {!compact && "WhatsApp"}
      </a>
    </div>
  );
}
