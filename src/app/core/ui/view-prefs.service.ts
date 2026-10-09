import { Injectable, signal } from '@angular/core';

const ADVANCED_KEY = 'snowball.show-advanced';

/**
 * Per-browser display preferences.
 *
 * `advanced` reveals the investor-grade figures (time-weighted return,
 * allocation drift, fund fees, yields…). Off by default so the app reads
 * plainly for people who aren't into finance.
 */
@Injectable({ providedIn: 'root' })
export class ViewPrefsService {
  readonly advanced = signal(read(ADVANCED_KEY));

  setAdvanced(value: boolean): void {
    this.advanced.set(value);
    write(ADVANCED_KEY, value);
  }

  toggleAdvanced(): void {
    this.setAdvanced(!this.advanced());
  }
}

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function write(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Private browsing — the preference lasts for the session only.
  }
}
