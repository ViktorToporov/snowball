import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';

/**
 * Every feature is lazily loaded, so the initial bundle is the shell,
 * the design system and the store — the rest arrives as it is visited.
 */
export const routes: Routes = [
  {
    // Outside the guest guard: the recovery link signs the user in first.
    path: 'auth/reset-password',
    title: 'Reset password · Snowball',
    loadComponent: () =>
      import('./features/auth/reset-password.component').then((m) => m.ResetPasswordComponent),
  },

  {
    path: 'auth',
    canActivate: [guestGuard],
    children: [
      {
        path: 'sign-in',
        title: 'Sign in · Snowball',
        loadComponent: () => import('./features/auth/auth-page.component').then((m) => m.AuthPageComponent),
      },
      {
        path: 'sign-up',
        title: 'Create account · Snowball',
        loadComponent: () => import('./features/auth/auth-page.component').then((m) => m.AuthPageComponent),
      },
      { path: '', pathMatch: 'full', redirectTo: 'sign-in' },
    ],
  },

  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: 'dashboard',
        title: 'Overview · Snowball',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'cash-flow',
        title: 'Money & bills · Snowball',
        loadComponent: () =>
          import('./features/cash-flow/cash-flow.component').then((m) => m.CashFlowComponent),
      },
      {
        path: 'investments',
        title: 'Investments · Snowball',
        loadComponent: () =>
          import('./features/investments/investments.component').then((m) => m.InvestmentsComponent),
      },
      {
        path: 'net-worth',
        title: 'Net worth · Snowball',
        loadComponent: () =>
          import('./features/net-worth/net-worth.component').then((m) => m.NetWorthComponent),
      },
      {
        path: 'property',
        title: 'Property · Snowball',
        loadComponent: () =>
          import('./features/property/property.component').then((m) => m.PropertyComponent),
      },
      {
        path: 'goals',
        title: 'Goals · Snowball',
        loadComponent: () => import('./features/goals/goals.component').then((m) => m.GoalsComponent),
      },
      {
        path: 'strategy',
        title: 'My plan · Snowball',
        loadComponent: () =>
          import('./features/strategy/strategy.component').then((m) => m.StrategyComponent),
      },
      {
        path: 'forecasts',
        title: 'Future · Snowball',
        loadComponent: () =>
          import('./features/forecasts/forecasts.component').then((m) => m.ForecastsComponent),
      },
      {
        path: 'check-in',
        title: 'Monthly check-in · Snowball',
        loadComponent: () =>
          import('./features/check-in/check-in.component').then((m) => m.CheckInComponent),
      },
      {
        path: 'settings',
        title: 'Settings · Snowball',
        loadComponent: () =>
          import('./features/settings/settings.component').then((m) => m.SettingsComponent),
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },

  { path: '**', redirectTo: 'dashboard' },
];
