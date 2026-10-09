import { Injectable, effect, signal } from '@angular/core';

import { ThemePreference } from '../models/domain.models';

const STORAGE_KEY = 'snowball.theme';

/**
 * Light / dark / system theme. Writes `data-theme` on <html> so the CSS
 * custom properties in `styles.scss` swap in one place; 'system' clears
 * the attribute and lets `prefers-color-scheme` decide.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly preference = signal<ThemePreference>(readStored());
  /** The theme actually in effect, with 'system' resolved. */
  readonly resolved = signal<'light' | 'dark'>('light');

  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    this.media.addEventListener('change', () => {
      if (this.preference() === 'system') this.apply();
    });

    effect(() => {
      const preference = this.preference();
      localStorage.setItem(STORAGE_KEY, preference);
      this.apply();
    });
  }

  set(preference: ThemePreference): void {
    this.preference.set(preference);
  }

  toggle(): void {
    this.preference.set(this.resolved() === 'dark' ? 'light' : 'dark');
  }

  private apply(): void {
    const preference = this.preference();
    const root = document.documentElement;

    if (preference === 'system') {
      root.removeAttribute('data-theme');
      this.resolved.set(this.media.matches ? 'dark' : 'light');
    } else {
      root.setAttribute('data-theme', preference);
      this.resolved.set(preference);
    }

    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', this.resolved() === 'dark' ? '#0a0c11' : '#f4f5f7');
  }
}

function readStored(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}
