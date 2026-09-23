import type { ReactNode } from "react";

export function Modal({
  title,
  onClose,
  children,
  wide
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal ${wide ? "wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}
