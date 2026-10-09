import { DOCUMENT } from '@angular/common';
import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy, inject, output } from '@angular/core';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Makes a hand-rolled `.dialog` behave like a real modal:
 *
 * - moves focus inside on open (first form field, else first control)
 * - keeps Tab / Shift+Tab inside the dialog
 * - Escape emits `dismiss`
 * - gives focus back to whatever opened it when it closes
 *
 *     <div class="dialog" role="dialog" aria-modal="true" sbDialog (dismiss)="close()">
 */
@Directive({ selector: '[sbDialog]', standalone: true })
export class DialogDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly returnFocusTo = this.document.activeElement as HTMLElement | null;

  readonly dismiss = output<void>();

  ngAfterViewInit(): void {
    const el = this.host.nativeElement;
    const target =
      el.querySelector<HTMLElement>('[autofocus]') ??
      el.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select, textarea') ??
      this.focusable()[0] ??
      el;
    if (target === el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    queueMicrotask(() => target.focus());
  }

  ngOnDestroy(): void {
    if (this.returnFocusTo && this.document.contains(this.returnFocusTo)) this.returnFocusTo.focus();
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.dismiss.emit();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = this.focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = this.document.activeElement;

    if (event.shiftKey && (active === first || active === this.host.nativeElement)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusable(): HTMLElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null || node === this.document.activeElement,
    );
  }
}
