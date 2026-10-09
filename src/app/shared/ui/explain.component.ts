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
import { RouterLink } from '@angular/router';

import { ExplainKey } from '../../core/explain/explain.model';
import { ExplainService } from '../../core/explain/explain.service';

/** How far the page may scroll under an open panel before it closes. */
const SCROLL_TOLERANCE = 40;

/**
 * The "what does this mean?" affordance.
 *
 * Sits beside any calculated figure. With a mouse it opens on hover for a
 * quick read and pins on click; on touch a tap pins it open; Enter/Space
 * pins it from the keyboard. The panel leads with what the figure means
 * for this user, then (collapsed) the worked example from their own live
 * data. When there is no data yet it still explains the figure in words.
 */
@Component({
  selector: 'sb-explain',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      <span class="explain" #host>
        <button
          #trigger
          type="button"
          class="explain__trigger"
          [class.is-open]="open()"
          [attr.aria-expanded]="open()"
          [attr.aria-label]="'What does ' + v.title + ' mean?'"
          (click)="toggle()"
          (pointerenter)="onPointerEnter($event)"
          (pointerleave)="onPointerLeave($event)"
          (focus)="onFocus()"
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
            [attr.aria-label]="v.title"
            (pointerenter)="onPointerEnter($event)"
            (pointerleave)="onPointerLeave($event)"
          >
            <div class="explain__head">
              <p class="explain__title">{{ v.title }}</p>
              @if (pinned()) {
                <button type="button" class="explain__close" (click)="close()" aria-label="Close">✕</button>
              }
            </div>

            @if (v.meaning) {
              <p class="explain__meaning">{{ v.meaning }}</p>
            }

            <p class="explain__summary">{{ v.summary }}</p>

            @if (nextLink(); as link) {
              <a class="explain__next" [routerLink]="link.path" [queryParams]="link.query" (click)="close()">
                {{ link.label }} →
              </a>
            }

            @if (math(); as m) {
              <button
                type="button"
                class="explain__math-toggle"
                [attr.aria-expanded]="showMath()"
                [attr.aria-controls]="mathId"
                (click)="showMath.set(!showMath()); pinned.set(true)"
              >
                <span class="explain__chevron" [class.is-open]="showMath()" aria-hidden="true">›</span>
                {{ showMath() ? 'Hide the math' : 'Show the math' }}
              </button>

              @if (showMath()) {
                <div class="explain__math" [id]="mathId">
                  <p class="explain__formula">{{ m.formula }}</p>

                  <p class="explain__eyebrow">With your numbers</p>
                  <ul class="explain__steps">
                    @for (step of m.steps; track $index) {
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
                    <span>{{ m.result.label }}</span>
                    <span class="num">{{ m.result.value }}</span>
                  </div>

                  @if (m.note) {
                    <p class="explain__note">{{ m.note }}</p>
                  }
                </div>
              }
            }

            @if (v.source) {
              <p class="explain__source">Where to change this: {{ v.source }}</p>
            }
          </div>
        }
      </span>
    }
  `,
  styleUrl: './explain.component.scss',
})
export class ExplainComponent {
  private static nextId = 0;

  private readonly explain = inject(ExplainService);
  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');

  readonly key = input.required<ExplainKey>();

  readonly pinned = signal(false);
  private readonly hovering = signal(false);
  readonly open = computed(() => this.pinned() || this.hovering());
  readonly position = signal({ left: 0, top: 0 });
  readonly showMath = signal(false);
  readonly mathId = `sb-explain-math-${ExplainComponent.nextId++}`;

  /** The full worked example, or null when there is not enough data yet. */
  readonly math = computed(() => {
    const full = this.explain.explain(this.key());
    return full && full.steps.length ? full : null;
  });

  /** What the panel shows in words: the full explanation, or the plain fallback. */
  readonly view = computed(() => this.explain.explain(this.key()) ?? this.explain.basic(this.key()));

  /** `nextStep.route` may carry a query string ("/cash-flow?tab=bills"). */
  readonly nextLink = computed(() => {
    const step = this.view()?.nextStep;
    if (!step) return null;
    const [path, search] = step.route.split('?');
    const query: Record<string, string> = {};
    if (search) new URLSearchParams(search).forEach((value, name) => (query[name] = value));
    return { label: step.label, path, query };
  });

  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private openedAtScroll = 0;

  /** Hover-peek is for mice only — on touch it would fight the tap. */
  onPointerEnter(event: PointerEvent): void {
    if (event.pointerType === 'mouse') this.peek();
  }

  onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'mouse') this.unpeek();
  }

  /** Keyboard focus peeks; the focus a tap or click gives the button does not. */
  onFocus(): void {
    if (this.trigger()?.nativeElement.matches(':focus-visible')) this.peek();
  }

  peek(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    if (!this.open()) this.place();
    this.hovering.set(true);
  }

  unpeek(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    // A short grace period so the pointer can travel to the panel.
    this.hoverTimer = setTimeout(() => this.hovering.set(false), 160);
  }

  toggle(): void {
    const next = !this.pinned();
    if (next) this.place();
    this.pinned.set(next);
    // Unpinning closes outright, even if a hover or focus peek is active.
    if (!next) this.close();
  }

  close(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.pinned.set(false);
    this.hovering.set(false);
    this.showMath.set(false);
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
    this.openedAtScroll = window.scrollY;
  }

  /** Clicks inside this explainer (panel, "Show the math") keep it open. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.pinned()) return;
    const target = event.target as Node | null;
    if (target && this.host()?.nativeElement.contains(target)) return;
    this.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.close();
  }

  /**
   * A small scroll (a thumb resting on a phone screen) follows the
   * trigger; a real scroll away closes the panel.
   */
  @HostListener('window:scroll')
  onScroll(): void {
    if (!this.open()) return;
    if (Math.abs(window.scrollY - this.openedAtScroll) > SCROLL_TOLERANCE) {
      this.close();
      return;
    }
    const scrolled = this.openedAtScroll;
    this.place();
    this.openedAtScroll = scrolled;
  }

  @HostListener('window:resize')
  onResize(): void {
    if (!this.open()) return;
    const scrolled = this.openedAtScroll;
    this.place();
    this.openedAtScroll = scrolled;
  }
}
