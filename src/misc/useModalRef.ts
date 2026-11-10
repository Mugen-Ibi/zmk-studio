import { useEffect, useRef } from "react";
export function useModalRef(
  open: boolean,
  closeOnOutsideClick?: boolean,
  allowCancel?: boolean,
) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    const cancel = (event: Event) => {
      if (allowCancel === false) event.preventDefault();
    };
    const outside = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const { top, left, right, bottom } = dialog.getBoundingClientRect();
      if (
        event.clientY < top ||
        event.clientY > bottom ||
        event.clientX < left ||
        event.clientX > right
      )
        dialog.close();
    };
    dialog.addEventListener("cancel", cancel);
    if (closeOnOutsideClick) dialog.addEventListener("click", outside);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("click", outside);
    };
  }, [open, closeOnOutsideClick, allowCancel]);
  return ref;
}
