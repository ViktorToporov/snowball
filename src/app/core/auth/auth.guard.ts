import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

/** Blocks the app shell until there is a session. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.whenReady();
  if (auth.isAuthenticated()) return true;

  return router.createUrlTree(['/auth/sign-in'], { queryParams: { redirectTo: state.url } });
};

/** Keeps signed-in users out of the sign-in / sign-up screens. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.whenReady();
  return auth.isAuthenticated() ? router.createUrlTree(['/dashboard']) : true;
};
