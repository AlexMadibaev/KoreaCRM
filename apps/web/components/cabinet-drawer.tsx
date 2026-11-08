'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function CabinetDrawer({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialogRef} className="crm-document-drawer" aria-labelledby={headingId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="crm-document-drawer-head"><button className="ks-button ks-button--ghost ks-button--icon" type="button" aria-label="Закрыть карточку" onClick={onClose}><X size={20} aria-hidden /></button><h2 id={headingId}>{title}</h2></header>
    <div className="crm-document-drawer-body">{children}</div>
  </dialog>;
}
