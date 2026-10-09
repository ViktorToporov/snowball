import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../core/auth/auth.service';
import { FinanceStore } from '../core/state/finance.store';
import { ThemeService } from '../core/ui/theme.service';
import { LogoComponent } from '../shared/ui/logo.component';
import { ToastHostComponent } from '../shared/ui/ui-kit';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  group: 'overview' | 'money' | 'plan';
}

/** SVG path data, 20×20 viewBox, 1.5px stroke. */
const ICONS: Record<string, string> = {
  dashboard: 'M3.5 4.5h5.5v5.5H3.5zM11 4.5h5.5v3.5H11zM11 10.5h5.5v5H11zM3.5 12.5h5.5v3H3.5z',
  cash: 'M2.5 6.5h15v8h-15zM10 12a2 2 0 100-4 2 2 0 000 4zM5.5 10h.01M14.5 10h.01',
  investments: 'M3.5 15.5l4-4.5 3 2.5 6.5-7M17 6.5h-3.5M17 6.5V10',
  networth: 'M3.5 16.5V9M8 16.5V4.5M12.5 16.5v-5M17 16.5V7',
  goals: 'M10 17a7 7 0 100-14 7 7 0 000 14zM10 13.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4zM10 10h.01',
  strategy: 'M10 2.8l6.5 3.2v4.6c0 3.4-2.6 5.7-6.5 6.6-3.9-.9-6.5-3.2-6.5-6.6V6z M7.6 10l1.8 1.8 3.4-3.6',
  property: 'M3.5 8.5L10 3.5l6.5 5v8h-13zM8 16.5v-4.5h4v4.5',
  forecasts: 'M3.5 16.5h13M5.5 13.5l3-3.5 3 2 3.5-5M14 6h1.5v1.5',
  settings:
    'M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM16 10c0-.5-.05-.9-.15-1.35l1.4-1.05-1.5-2.6-1.65.65a5.6 5.6 0 00-2.3-1.35L11.5 2.5h-3l-.3 1.8a5.6 5.6 0 00-2.3 1.35L4.25 5 2.75 7.6l1.4 1.05C4.05 9.1 4 9.5 4 10s.05.9.15 1.35L2.75 12.4l1.5 2.6 1.65-.65a5.6 5.6 0 002.3 1.35l.3 1.8h3l.3-1.8a5.6 5.6 0 002.3-1.35l1.65.65 1.5-2.6-1.4-1.05c.1-.45.15-.85.15-1.35z',
};

const NAV: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', group: 'overview' },
  { path: '/cash-flow', label: 'Cash Flow', icon: 'cash', group: 'money' },
  { path: '/investments', label: 'Investments', icon: 'investments', group: 'money' },
  { path: '/net-worth', label: 'Net Worth', icon: 'networth', group: 'money' },
  { path: '/property', label: 'Property', icon: 'property', group: 'money' },
  { path: '/goals', label: 'Goals', icon: 'goals', group: 'plan' },
  { path: '/strategy', label: 'Strategy', icon: 'strategy', group: 'plan' },
  { path: '/forecasts', label: 'Forecasts', icon: 'forecasts', group: 'plan' },
  { path: '/settings', label: 'Settings', icon: 'settings', group: 'plan' },
];

@Component({
  selector: 'sb-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, LogoComponent, ToastHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell" [class.shell--nav-open]="mobileNavOpen()">
      <!-- Sidebar (desktop) / drawer (mobile) -->
      <aside class="sidebar" [class.is-open]="mobileNavOpen()">
        <div class="sidebar__brand">
          <a routerLink="/dashboard" aria-label="Snowball home">
            <sb-logo [showTagline]="true" />
          </a>
        </div>

        <nav class="sidebar__nav" aria-label="Main">
          @for (group of groups; track group.key) {
            <div class="nav-group">
              <p class="eyebrow nav-group__label">{{ group.label }}</p>
              <ul>
                @for (item of group.items; track item.path) {
                  <li>
                    <a
                      class="nav-item"
                      [routerLink]="item.path"
                      routerLinkActive="is-active"
                      (click)="mobileNavOpen.set(false)"
                    >
                      <svg class="nav-item__icon" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                           stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path [attr.d]="icons[item.icon]" />
                      </svg>
                      <span>{{ item.label }}</span>
                    </a>
                  </li>
                }
              </ul>
            </div>
          }
        </nav>

        <div class="sidebar__foot">
          @if (store.strategy(); as strategy) {
            <a routerLink="/strategy" class="strategy-chip" [class]="'strategy-chip strategy-chip--' + statusTone()">
              <span class="strategy-chip__dot"></span>
              <span class="col" style="gap:0">
                <span class="strategy-chip__title">{{ strategy.headline }}</span>
                <span class="strategy-chip__sub">{{ strategy.activePhase?.name ?? 'Strategy' }}</span>
              </span>
            </a>
          }

          @if (auth.isDemo()) {
            <p class="demo-note">
              <strong>Demo mode</strong> — sample data, stored in this browser only.
            </p>
          }
        </div>
      </aside>

      @if (mobileNavOpen()) {
        <div class="drawer-scrim" (click)="mobileNavOpen.set(false)" role="presentation"></div>
      }

      <div class="main">
        <header class="topbar">
          <button
            type="button"
            class="btn btn--quiet btn--icon topbar__burger"
            (click)="mobileNavOpen.set(!mobileNavOpen())"
            [attr.aria-expanded]="mobileNavOpen()"
            aria-label="Toggle navigation"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <path d="M3 5h12M3 9h12M3 13h12" />
            </svg>
          </button>

          <a routerLink="/dashboard" class="topbar__brand"><sb-logo /></a>

          <span class="spacer"></span>

          @if (store.isLoading()) {
            <span class="micro muted hide-sm">Loading…</span>
          } @else if (store.saving()) {
            <span class="micro muted hide-sm">Saving…</span>
          }

          <button type="button" class="btn btn--quiet btn--icon" (click)="theme.toggle()"
                  [attr.aria-label]="'Switch to ' + (theme.resolved() === 'dark' ? 'light' : 'dark') + ' mode'">
            @if (theme.resolved() === 'dark') {
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <circle cx="10" cy="10" r="3.6" />
                <path d="M10 2.5v1.8M10 15.7v1.8M17.5 10h-1.8M4.3 10H2.5M15.3 4.7l-1.3 1.3M6 14l-1.3 1.3M15.3 15.3L14 14M6 6L4.7 4.7" />
              </svg>
            } @else {
              <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
                <path d="M16.5 12.4A7 7 0 017.6 3.5a7 7 0 108.9 8.9z" />
              </svg>
            }
          </button>

          <div class="account">
            <button
              type="button"
              class="account__button"
              (click)="accountOpen.set(!accountOpen())"
              [attr.aria-expanded]="accountOpen()"
            >
              <span class="account__avatar">{{ initials() }}</span>
              <span class="account__name hide-sm">{{ accountName() }}</span>
            </button>

            @if (accountOpen()) {
              <div class="account__menu" role="menu">
                <div class="account__menu-head">
                  <p class="small" style="font-weight:600">{{ accountName() }}</p>
                  <p class="micro muted">{{ auth.user()?.email }}</p>
                </div>
                <a routerLink="/settings" class="account__menu-item" role="menuitem" (click)="accountOpen.set(false)">
                  Settings
                </a>
                <button type="button" class="account__menu-item" role="menuitem" (click)="signOut()">
                  Sign out
                </button>
              </div>
            }
          </div>
        </header>

        <main class="content" (click)="accountOpen.set(false)">
          <router-outlet />
        </main>
      </div>
    </div>

    <sb-toasts />
  `,
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  readonly store = inject(FinanceStore);
  private readonly router = inject(Router);

  readonly icons = ICONS;
  readonly mobileNavOpen = signal(false);
  readonly accountOpen = signal(false);

  readonly groups = [
    { key: 'overview', label: 'Overview', items: NAV.filter((n) => n.group === 'overview') },
    { key: 'money', label: 'Money', items: NAV.filter((n) => n.group === 'money') },
    { key: 'plan', label: 'Plan', items: NAV.filter((n) => n.group === 'plan') },
  ];

  /** The profile row is authoritative; the auth session is the fallback. */
  readonly accountName = computed(
    () => this.store.profile()?.displayName?.trim() || this.auth.displayName(),
  );

  readonly initials = computed(() => {
    const name = this.accountName();
    return name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  });

  readonly statusTone = computed(() => {
    const status = this.store.strategy()?.status;
    if (status === 'ahead' || status === 'on-track') return 'good';
    if (status === 'attention') return 'warn';
    if (status === 'off-track') return 'bad';
    return 'info';
  });

  constructor() {
    // Load the dataset once a session exists, and again if the user changes.
    effect(() => {
      if (this.auth.isAuthenticated()) void this.store.load();
    });
  }

  async signOut(): Promise<void> {
    this.accountOpen.set(false);
    await this.auth.signOut();
    await this.router.navigate(['/auth/sign-in']);
  }
}
