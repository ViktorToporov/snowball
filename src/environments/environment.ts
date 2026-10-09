/**
 * Snowball environment configuration.
 *
 * Copy `environment.example.ts` over this file and fill in your own
 * Supabase project details. Leave them blank to run the app in **demo
 * mode**, where a realistic in-memory dataset stands in for the backend.
 *
 * Only ever put the *publishable* (anon) key here — it ships to the
 * browser. The service-role key must never appear in this application.
 */
export const environment = {
  production: false,

  /** e.g. 'https://abcdefghijklmnop.supabase.co' */
  supabaseUrl: '',

  /** The project's publishable / anon key. Never the service-role key. */
  supabaseAnonKey: '',

  /**
   * Force demo mode even when Supabase credentials are present.
   * Handy for screenshots and offline development.
   */
  forceDemoMode: false,

  appName: 'Snowball',
  tagline: 'Keep the dough rolling.',
  defaultCurrency: 'EUR',
  defaultLocale: 'en-IE',
};
