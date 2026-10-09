/**
 * Template for `environment.ts`.
 *
 *   cp src/environments/environment.example.ts src/environments/environment.ts
 *
 * Find both values in the Supabase dashboard under
 * Project Settings → API. Use the **anon / publishable** key.
 * The service-role key must never be placed in a browser application.
 */
export const environment = {
  production: false,

  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-PUBLISHABLE-ANON-KEY',

  /** Set true to run against the bundled demo dataset instead. */
  forceDemoMode: false,

  appName: 'Snowball',
  tagline: 'Keep the dough rolling.',
  defaultCurrency: 'EUR',
  defaultLocale: 'en-IE',
};
