import { useEffect, useRef, type RefObject } from 'react';

/**
 * Shared a11y wiring for both confirmation dialogs (design D4b, row 58):
 * while `open`, captures the element focused before opening, moves focus
 * into the dialog, and restores focus to that element once the dialog
 * closes (prop flips to `false`, or the component unmounts). A separate
 * effect calls `onCancel` on `Escape` — it never calls `onConfirm`; a
 * presentational dialog never assumes what confirming means.
 */
export function useDialogLifecycle(
  open: boolean,
  onCancel: () => void,
): RefObject<HTMLDivElement | null> {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement; // capture BEFORE moving focus
    dialogRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onCancel();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onCancel]);

  return dialogRef;
}
