"use client";
import { useEffect, useRef, useState } from "react";

const MAX_SIDE = 2000;
const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Foto grande do celular → JPEG menor (documento continua legível). PDF e imagens pequenas seguem como estão. */
async function shrink(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type) || (f.size < 600 * 1024 && f.type !== "image/heic")) return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return f; // navegador não conseguiu ler (ex.: HEIC fora do iPhone): envia o original
  }
}

/** Anexar documentos (fotos ou PDF). Os arquivos vão no mesmo envio do formulário (campo "files"). */
export function FileAttach({ name = "files", max = 12, hint }: { name?: string; max?: number; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  // formulário limpo depois do envio: a lista também
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const clear = () => setFiles([]);
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);

  function sync(list: File[]) {
    setFiles(list);
    if (!input.current) return;
    const dt = new DataTransfer();
    list.forEach((f) => dt.items.add(f));
    input.current.files = dt.files;
  }

  async function onPick(picked: FileList | null) {
    if (!picked?.length) return sync(files);
    setBusy(true);
    const ready = await Promise.all(Array.from(picked).map(shrink));
    setBusy(false);
    sync([...files, ...ready].slice(0, max));
  }

  return (
    <div className="mb-5">
      <p className="mb-1 text-sm font-semibold text-ink">Documentos do cliente</p>
      <p className="mb-3 text-[13px] text-ink-3">{hint ?? "RG ou CNH, comprovante de renda, comprovante de residência… Fotos ou PDF. Ficam protegidos e só a consultora e a gestão veem."}</p>
      {/* o input fica escondido, mas é ele que vai no envio (lista ajustada abaixo) */}
      <input ref={input} id={`${name}-input`} type="file" name={name} multiple accept="image/*,application/pdf" className="sr-only" onChange={(e) => onPick(e.target.files)} />
      {files.length > 0 && (
        <ul className="mb-3 divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14px]">
              <span className="min-w-0">
                <span className="block truncate font-medium">{f.name}</span>
                <span className="text-[12px] text-ink-3">{f.type === "application/pdf" ? "PDF" : "Imagem"} · {fmtSize(f.size)}</span>
              </span>
              <button type="button" onClick={() => sync(files.filter((_, j) => j !== i))} className="press min-h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold text-bad hover:bg-bad-soft">
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length < max && (
        <label htmlFor={`${name}-input`} className="press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-dashed border-line-strong px-4 text-[14px] font-semibold hover:border-ink">
          <span aria-hidden>📎</span> {busy ? "Preparando…" : files.length ? "Anexar mais" : "Anexar documentos"}
        </label>
      )}
    </div>
  );
}
