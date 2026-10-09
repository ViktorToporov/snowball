import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { NetWorthPart } from '../../core/engine/metrics';
import { CurrencyService } from '../../core/money/currency.service';

/**
 * Net worth in its plain parts — Money · Investments · Property (and
 * "Other things & debts" when there is any) — shown under the total.
 * The parts come from `netWorthSummary().split` and add up to it.
 */
@Component({
  selector: 'sb-net-worth-split',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dl class="split" [class.split--large]="large()">
      @for (part of parts(); track part.key) {
        <div class="split__part">
          <dt class="split__label">{{ part.label }}</dt>
          <dd class="split__value num" [class.neg]="part.value < 0">{{ money(part.value) }}</dd>
        </div>
      }
    </dl>
  `,
  styles: [
    `
      :host { display: block; }
      .split {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 18px;
        margin: 0;
      }
      .split__part { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .split__label { font-size: 11.5px; color: var(--ink-muted); font-weight: 550; }
      .split__value { margin: 0; font-size: 14px; font-weight: 620; color: var(--ink); font-variant-numeric: tabular-nums; }
      .split__value.neg { color: var(--negative-ink, var(--negative)); }
      .split--large { gap: 10px 28px; }
      .split--large .split__label { font-size: 12.5px; }
      .split--large .split__value { font-size: 18px; }
    `,
  ],
})
export class NetWorthSplitComponent {
  private readonly currency = inject(CurrencyService);

  readonly parts = input.required<readonly NetWorthPart[]>();
  readonly large = input(false);

  money(value: number): string {
    return this.currency.format(value, { decimals: 0 });
  }
}
