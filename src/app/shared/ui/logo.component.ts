import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The Snowball wordmark: three stacked discs rolling downhill, then the
 * name. Deliberately a simple text-plus-glyph treatment — the interface
 * around it does the heavy lifting.
 */
@Component({
  selector: 'sb-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="logo" [class.logo--lg]="large()">
      <svg class="logo__mark" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="9" cy="19.5" r="7" class="logo__ball logo__ball--lg" />
        <circle cx="18.5" cy="12" r="4.6" class="logo__ball logo__ball--md" />
        <circle cx="24" cy="6" r="2.6" class="logo__ball logo__ball--sm" />
      </svg>
      <span class="logo__text">
        <span class="logo__name">Snowball</span>
        @if (showTagline()) {
          <span class="logo__tagline">Keep the dough rolling.</span>
        }
      </span>
    </span>
  `,
  styles: [
    `
      .logo { display: inline-flex; align-items: center; gap: 10px; }
      .logo__mark { width: 28px; height: 28px; flex: none; }
      .logo--lg .logo__mark { width: 36px; height: 36px; }
      .logo__ball--lg { fill: var(--brand); }
      .logo__ball--md { fill: var(--brand); opacity: 0.68; }
      .logo__ball--sm { fill: var(--brand); opacity: 0.4; }
      .logo__text { display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
      .logo__name {
        font-size: 17px;
        font-weight: 660;
        letter-spacing: -0.028em;
        color: var(--ink);
      }
      .logo--lg .logo__name { font-size: 24px; }
      .logo__tagline {
        font-size: 10.5px;
        color: var(--ink-muted);
        letter-spacing: 0.01em;
      }
      .logo--lg .logo__tagline { font-size: 12.5px; }
    `,
  ],
})
export class LogoComponent {
  readonly showTagline = input(false);
  readonly large = input(false);
}
