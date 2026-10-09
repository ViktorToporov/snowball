import { allocate, amortiseMonth, annuityPayment, dec, futureValue, money, num } from './money';

describe('money', () => {
  it('adds without floating-point drift', () => {
    // The reason this module exists at all.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(money.add(0.1, 0.2).toNumber()).toBe(0.3);
  });

  it('sums a long list of cents exactly', () => {
    const cents = Array.from({ length: 1000 }, () => 0.01);
    expect(money.sum(cents).toNumber()).toBe(10);
  });

  it('parses PostgREST numeric strings', () => {
    expect(num('1234.5678')).toBe(1234.5678);
    expect(num('1,234.56')).toBe(1234.56);
    expect(num(null)).toBe(0);
    expect(num('not a number')).toBe(0);
  });

  it('never divides by zero', () => {
    expect(money.div(100, 0).toNumber()).toBe(0);
    expect(money.percentOf(50, 0).toNumber()).toBe(0);
  });

  it('reports change against a negative base by magnitude', () => {
    expect(money.changePercent(50, 100)).toBe(-50);
    expect(money.changePercent(-50, -100)).toBe(50);
    expect(money.changePercent(10, 0)).toBeNull();
  });
});

describe('allocate', () => {
  it('splits a total so the parts sum back exactly', () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
    expect(money.sum(parts).toNumber()).toBe(100);
  });

  it('respects weights', () => {
    const parts = allocate(1000, [40, 25, 20, 15]);
    expect(parts).toEqual([400, 250, 200, 150]);
  });

  it('handles a zero weight total', () => {
    expect(allocate(100, [0, 0])).toEqual([0, 0]);
  });
});

describe('amortisation', () => {
  it('splits a payment into interest and principal', () => {
    // €69,416 at 2.8%: one month of interest is 69416 * 0.028 / 12.
    const step = amortiseMonth(69416, 0.028, 353);
    expect(step.interest.toDecimalPlaces(2).toNumber()).toBe(161.97);
    expect(step.principal.toDecimalPlaces(2).toNumber()).toBe(191.03);
    expect(step.closing.toDecimalPlaces(2).toNumber()).toBe(69224.97);
  });

  it('never overpays the outstanding balance', () => {
    const step = amortiseMonth(100, 0.03, 500);
    expect(step.principal.toNumber()).toBe(100);
    expect(step.closing.toNumber()).toBe(0);
  });

  it('derives a level payment that clears the loan', () => {
    const payment = annuityPayment(100000, 0.03, 300);
    let balance = dec(100000);
    for (let m = 0; m < 300; m += 1) balance = amortiseMonth(balance, 0.03, payment).closing;
    expect(balance.toDecimalPlaces(2).toNumber()).toBe(0);
  });
});

describe('futureValue', () => {
  it('compounds a lump sum', () => {
    // 12 monthly steps at 7%/12 on €1,000, no contributions.
    expect(futureValue(1000, 0, 0.07, 12).toDecimalPlaces(2).toNumber()).toBe(1072.29);
  });

  it('adds monthly contributions', () => {
    const value = futureValue(0, 100, 0.06, 12).toDecimalPlaces(2).toNumber();
    expect(value).toBeGreaterThan(1200); // more than the 12 × €100 paid in
    expect(value).toBeLessThan(1250);
  });
});
