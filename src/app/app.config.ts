import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { DemoRepository } from './core/data/demo.repository';
import { FINANCE_REPOSITORY } from './core/data/finance.repository';
import { SupabaseRepository } from './core/data/supabase.repository';
import { SupabaseService } from './core/supabase/supabase.service';
import { ThemeService } from './core/ui/theme.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),

    /**
     * The whole app talks to `FINANCE_REPOSITORY`; which implementation
     * backs it is decided here, once, from the environment config.
     */
    {
      provide: FINANCE_REPOSITORY,
      useFactory: () => {
        const supabase = inject(SupabaseService);
        return supabase.isConfigured ? inject(SupabaseRepository) : inject(DemoRepository);
      },
    },

    // Apply the stored theme before the first paint.
    provideAppInitializer(() => {
      inject(ThemeService);
    }),
  ],
};
