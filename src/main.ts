import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

const hasCredentials =
  !!environment.supabaseUrl &&
  !!environment.supabaseAnonKey &&
  !environment.supabaseUrl.includes('YOUR-PROJECT-REF');

if (environment.production && !hasCredentials && !environment.forceDemoMode) {
  // A production build without a backend would quietly serve the demo,
  // letting any email and password "sign in" to fake data. Fail loudly.
  document.body.innerHTML = `
    <main style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 16px;line-height:1.5">
      <h1 style="font-size:20px">Snowball is not configured</h1>
      <p>This build has no Supabase URL or publishable key. Add them to
      <code>src/environments/environment.prod.ts</code> and rebuild, or set
      <code>forceDemoMode: true</code> to host the demo.</p>
    </main>`;
} else {
  bootstrapApplication(App, appConfig).catch((err) => console.error(err));
}
