/**
 * Production environment — swapped in for `environment.ts` by
 * `ng build` (see `fileReplacements` in angular.json).
 *
 * Fill in the same two values from Supabase → Project Settings → API.
 * Only ever the *publishable* (anon) key — it ships to the browser.
 *
 * A production build with these left blank refuses to start rather
 * than silently falling back to demo mode (see `main.ts`). To host the
 * demo on purpose, set `forceDemoMode: true`.
 */
export const environment = {
  production: true,

  /** e.g. 'https://abcdefghijklmnop.supabase.co' */
  supabaseUrl: '',

  /** The project's publishable / anon key. Never the service-role key. */
  supabaseAnonKey: '',

  /** Host the bundled demo dataset instead of a real backend. */
  forceDemoMode: false,

  appName: 'Snowball',
  tagline: 'Keep the dough rolling.',
  defaultCurrency: 'EUR',
  defaultLocale: 'en-IE',
};
