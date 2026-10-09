import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { ExplainKey } from '../../core/explain/explain.model';
import { ExplainService } from '../../core/explain/explain.service';

/**
 * The "how is this worked out?" affordance.
 *
 * Sits beside any calculated figure. Opens on hover for a quick read and
 * pins on click (or Enter/Space) so the panel can be studied and its
 * numbers checked. The content is built from the user's own live data,
 * not a generic worked example.
 */
@Component({
  selector: 'sb-explain',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (explanation()) {
      <span class="explain" #host>
        <button
          type="button"
          class="explain__trigger"
          [class.is-open]="open()"
          [attr.aria-expanded]="open()"
          [attr.aria-label]="'How is ' + explanation()!.title + ' calculated?'"
          (click)="toggle($event)"
          (mouseenter)="peek()"
          (mouseleave)="unpeek()"
          (focus)="peek()"
          (blur)="unpeek()"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 7.1v4" stroke-linecap="round" />
            <path d="M8 4.9v.1" stroke-linecap="round" />
          </svg>
        </button>

        @if (open()) {
          <div
            class="explain__panel"
            [style.left.px]="position().left"
            [style.top.px]="position().top"
            [attr.role]="pinned() ? 'dialog' : 'tooltip'"
            [attr.aria-label]="explanation()!.title"
            (mouseenter)="peek()"
            (mouseleave)="unpeek()"
          >
            <div class="explain__head">
              <p class="explain__title">{{ explanation()!.title }}</p>
              @if (pinned()) {
                <button type="button" class="explain__close" (click)="close()" aria-label="Close">✕</button>
              }
            </div>

            <p class="explain__summary">{{ explanation()!.summary }}</p>

            <p class="explain__formula">{{ explanation()!.formula }}</p>

            <p class="explain__eyebrow">With your numbers</p>
            <ul class="explain__steps">
              @for (step of explanation()!.steps; track step.label) {
                <li class="explain__step">
                  <span class="explain__sign" aria-hidden="true">{{ step.negative ? '−' : '+' }}</span>
                  <span class="explain__step-body">
                    <span class="explain__step-label">{{ step.label }}</span>
                    @if (step.hint) {
                      <span class="explain__hint">{{ step.hint }}</span>
                    }
                  </span>
                  <span class="explain__step-value num">{{ step.value }}</span>
                </li>
              }
            </ul>

            <div class="explain__result">
              <span>{{ explanation()!.result.label }}</span>
              <span class="num">{{ explanation()!.result.value }}</span>
            </div>

            @if (explanation()!.note) {
              <p class="explain__note">{{ explanation()!.note }}</p>
            }
            @if (explanation()!.source) {
              <p class="explain__source">Maintained in: {{ explanation()!.source }}</p>
            }
          </div>
        }
      </span>
    }
  `,
  styleUrl: './explain.component.scss',
})
export class ExplainComponent {
  private readonly explain = inject(ExplainService);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');

  readonly key = input.required<ExplainKey>();

  readonly pinned = signal(false);
  private readonly hovering = signal(false);
  readonly open = computed(() => this.pinned() || this.hovering());
  readonly position = signal({ left: 0, top: 0 });

  readonly explanation = computed(() => this.explain.explain(this.key()));

  private hoverTimer: ReturnType<typeof setTimeout> | null = null;

  peek(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.place();
    this.hovering.set(true);
  }

  unpeek(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    // A short grace period so the pointer can travel to the panel.
    this.hoverTimer = setTimeout(() => this.hovering.set(false), 160);
  }

  toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.place();
    this.pinned.update((v) => !v);
  }

  close(): void {
    this.pinned.set(false);
    this.hovering.set(false);
  }

  /**
   * Positioned with `position: fixed` off the trigger's own rect, then
   * clamped to the viewport — so the panel is never clipped by a card's
   * overflow and never runs off the edge of a narrow screen.
   */
  private place(): void {
    const element = this.host()?.nativeElement;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));

    // Flip above the trigger when there is not enough room below.
    const estimatedHeight = 300;
    const below = window.innerHeight - rect.bottom;
    const top = below > estimatedHeight || below > rect.top ? rect.bottom + 8 : Math.max(12, rect.top - estimatedHeight - 8);

    this.position.set({ left, top });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.pinned()) this.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onViewportChange(): void {
    if (this.open()) this.close();
  }
}
