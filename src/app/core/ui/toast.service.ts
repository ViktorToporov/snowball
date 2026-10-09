import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  text?: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  readonly toasts = signal<Toast[]>([]);

  private push(kind: ToastKind, title: string, text?: string, ttl = 4200): void {
    const toast: Toast = { id: this.nextId++, kind, title, text };
    this.toasts.update((list) => [...list, toast]);
    setTimeout(() => this.dismiss(toast.id), ttl);
  }

  success(title: string, text?: string): void { this.push('success', title, text); }
  error(title: string, text?: string): void { this.push('error', title, text, 6500); }
  info(title: string, text?: string): void { this.push('info', title, text); }
  warning(title: string, text?: string): void { this.push('warning', title, text, 5500); }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
