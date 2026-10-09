import { TestBed } from '@angular/core/testing';

import { FINANCE_REPOSITORY } from '../data/finance.repository';
import { DemoRepository } from '../data/demo.repository';
import { AuthService } from '../auth/auth.service';
import { FinanceStore } from '../state/finance.store';
import { ExplainKey } from './explain.model';
import { ExplainService } from './explain.service';

/**
 * The explanations exist so a reader can check the app's arithmetic by
 * hand. These tests check the checker: every explanation must produce a
 * formula, a worked example built from real numbers, and a result.
 */
describe('ExplainService', () => {
  let explain: ExplainService;

  const KEYS: ExplainKey[] = [
    'net-worth', 'liquid-cash', 'total-cash', 'emergency-fund', 'available-above-floor',
    'security-score', 'runway', 'monthly-income', 'essential-expenses', 'total-spending',
    'flexible-spending', 'savings-capacity', 'savings-rate', 'interest-per-year',
    'portfolio-value', 'unrealised-gain', 'portfolio-return', 'time-weighted-return',
    'contributions-vs-growth', 'allocation-drift', 'rebalance', 'property-equity',
    'loan-to-value', 'property-cash-flow', 'rental-yield', 'mortgage-split',
    'property-reserve', 'goal-required', 'planned-required', 'strategy-status',
    'forecast', 'currency-conversion',
  ];

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        DemoRepository,
        { provide: FINANCE_REPOSITORY, useExisting: DemoRepository },
      ],
    });

    // Sign in to the bundled demo dataset and load it.
    TestBed.inject(AuthService).demoSignIn();
    const store = TestBed.inject(FinanceStore);
    await store.load(true);

    explain = TestBed.inject(ExplainService);
  });

  it('explains every figure the UI asks about', () => {
    for (const key of KEYS) {
      const explanation = explain.explain(key);
      expect(explanation).withContext(`missing explanation for "${key}"`).not.toBeNull();
    }
  });

  it('gives each explanation a method and a result', () => {
    for (const key of KEYS) {
      const explanation = explain.explain(key)!;
      expect(explanation.title.length).withContext(key).toBeGreaterThan(2);
      expect(explanation.summary.length).withContext(key).toBeGreaterThan(20);
      expect(explanation.formula.length).withContext(key).toBeGreaterThan(5);
      expect(explanation.result.value.length).withContext(key).toBeGreaterThan(0);
    }
  });

  it('works the example through with real numbers, not placeholders', () => {
    for (const key of KEYS) {
      const explanation = explain.explain(key)!;
      expect(explanation.steps.length).withContext(key).toBeGreaterThan(0);

      for (const step of explanation.steps) {
        expect(step.label.length).withContext(`${key} step label`).toBeGreaterThan(0);
        expect(step.value.length).withContext(`${key} step value`).toBeGreaterThan(0);
        // A placeholder would give itself away here.
        expect(step.value).withContext(`${key} step value`).not.toContain('undefined');
        expect(step.value).withContext(`${key} step value`).not.toContain('NaN');
      }
      expect(explanation.result.value).not.toContain('NaN');
      expect(explanation.result.value).not.toContain('undefined');
    }
  });

  it('adds up: net worth equals its own worked example', () => {
    const explanation = explain.explain('net-worth')!;
    const parse = (text: string) => Number(text.replace(/[^0-9.−-]/g, '').replace('−', '-'));

    const total = explanation.steps.reduce(
      (sum, step) => sum + (step.negative ? -parse(step.value) : parse(step.value)),
      0,
    );
    expect(total).toBeCloseTo(parse(explanation.result.value), 0);
  });

  it('adds up: liquid cash equals the sum of the accounts it lists', () => {
    const explanation = explain.explain('liquid-cash')!;
    const parse = (text: string) => Number(text.replace(/[^0-9.]/g, ''));

    const total = explanation.steps.reduce((sum, step) => sum + parse(step.value), 0);
    expect(total).toBeCloseTo(parse(explanation.result.value), 0);
  });

  it('adds up: the security score equals the sum of its weighted factors', () => {
    const explanation = explain.explain('security-score')!;
    const points = explanation.steps.reduce((sum, step) => sum + Number(step.value.replace(' pts', '')), 0);
    const score = Number(explanation.result.value.split(' / ')[0]);
    expect(points).toBeCloseTo(score, 0);
  });

  it('returns null rather than a broken explanation for an unknown key', () => {
    expect(explain.explain('does-not-exist' as ExplainKey)).toBeNull();
  });
});
