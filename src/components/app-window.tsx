"use client";

import { motion } from "motion/react";
import { useState } from "react";
import type { PublicService } from "@/lib/services";

export type WinState = { x: number; y: number; w: number; h: number; z: number; min: boolean; max: boolean };

type Props = {
  service: PublicService;
  win: WinState;
  /** On a phone every window fills the screen. */
  mobile: boolean;
  /** True while any window is being dragged or resized, so iframes don't swallow the pointer. */
  interacting: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMin: () => void;
  onMax: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onInteract: (on: boolean) => void;
  /** A built-in app (like the calendar) drawn by the control room itself instead of an iframe. */
  children?: React.ReactNode;
};

const ctl = "grid size-7 place-items-center rounded-md text-mute hover:bg-paper/10 hover:text-paper";

export function AppWindow({ service, win, mobile, interacting, onFocus, onClose, onMin, onMax, onMove, onResize, onInteract, children }: Readonly<Props>) {
  const [reload, setReload] = useState(0);
  // The drag or resize in progress: where the pointer and the window started.
  const [drag, setDrag] = useState<{ kind: "move" | "size"; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const full = mobile || win.max;

  const begin = (kind: "move" | "size") => (e: React.PointerEvent<HTMLElement>) => {
    onFocus();
    if (full || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(kind === "move" ? { kind, sx: e.clientX, sy: e.clientY, ox: win.x, oy: win.y } : { kind, sx: e.clientX, sy: e.clientY, ox: win.w, oy: win.h });
    onInteract(true);
  };
  const step = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (drag.kind === "move") onMove(drag.ox + dx, drag.oy + dy);
    else onResize(drag.ox + dx, drag.oy + dy);
  };
  const end = () => {
    if (drag) onInteract(false);
    setDrag(null);
  };

  return (
    <motion.section
      role="dialog"
      aria-label={service.name}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.15 }}
      onPointerDownCapture={onFocus}
      className="absolute flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-black/60"
      style={{
        zIndex: win.z,
        display: win.min ? "none" : "flex",
        ...(full ? { inset: 0, borderRadius: mobile ? 0 : undefined } : { left: win.x, top: win.y, width: win.w, height: win.h }),
      }}
    >
      <header
        className={`flex h-10 shrink-0 select-none items-center gap-2 border-b border-line bg-surface-2 px-3 ${full ? "" : "cursor-grab active:cursor-grabbing"}`}
        style={{ touchAction: "none" }}
        onPointerDown={begin("move")}
        onPointerMove={step}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => !mobile && onMax()}
      >
        <span aria-hidden="true">{service.icon}</span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{service.name}</h2>
        {!children && (
          <>
            <button type="button" className={ctl} aria-label={`Reload ${service.name}`} title="Reload" onClick={() => setReload((n) => n + 1)}>
              ↻
            </button>
            <a className={ctl} href={service.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${service.name} in a new tab`} title="Open in a new tab">
              ↗
            </a>
          </>
        )}
        <button type="button" className={ctl} aria-label={`Minimise ${service.name}`} title="Minimise" onClick={onMin}>
          –
        </button>
        {!mobile && (
          <button type="button" className={ctl} aria-label={win.max ? `Restore ${service.name}` : `Maximise ${service.name}`} title={win.max ? "Restore" : "Maximise"} onClick={onMax}>
            {win.max ? "❐" : "☐"}
          </button>
        )}
        <button type="button" className={`${ctl} hover:!bg-down/20 hover:!text-down`} aria-label={`Close ${service.name}`} title="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {children ? (
        <div className="relative min-h-0 w-full flex-1" style={{ pointerEvents: interacting ? "none" : "auto" }}>
          {children}
        </div>
      ) : (
        <iframe
          key={reload}
          title={service.name}
          src={service.url}
          className="min-h-0 w-full flex-1 bg-white"
          style={{ pointerEvents: interacting ? "none" : "auto" }}
          // These are your own tools: they need scripts, their own storage, forms and file downloads.
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-modals"
          allow="clipboard-write"
        />
      )}
      {!full && (
        <div
          role="presentation"
          className="absolute bottom-0 right-0 size-5 cursor-nwse-resize"
          style={{ touchAction: "none" }}
          onPointerDown={begin("size")}
          onPointerMove={step}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <svg viewBox="0 0 20 20" className="size-full text-mute/60" aria-hidden="true">
            <path d="M18 8 8 18M18 13l-5 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </div>
      )}
    </motion.section>
  );
}
