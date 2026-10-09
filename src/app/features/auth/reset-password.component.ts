import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { LogoComponent } from '../../shared/ui/logo.component';

/**
 * Landing page for the password-reset email.
 *
 * Supabase's recovery link signs the user in (the session arrives in
 * the URL and `detectSessionInUrl` picks it up), so by the time this
 * renders there should be a session — this screen just asks for the
 * new password and saves it.
 */
@Component({
  selector: 'sb-reset-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="reset">
      <div class="card card--pad reset__card">
        <sb-logo [showTagline]="true" />

        @if (checking()) {
          <p class="small muted">Checking your reset link…</p>
        } @else if (!hasSession()) {
          <div class="col" style="gap:8px">
            <h1 class="h2">This link has expired</h1>
            <p class="small secondary">
              Reset links work once and only for a short time. Request a new one from the sign-in screen.
            </p>
          </div>
          <a routerLink="/auth/sign-in" class="btn btn--primary btn--block">Back to sign in</a>
        } @else {
          <div class="col" style="gap:4px">
            <h1 class="h2">Choose a new password</h1>
            <p class="small muted">You'll stay signed in once it's saved.</p>
          </div>

          <form [formGroup]="form" (ngSubmit)="submit()" class="col" style="gap:14px">
            <div class="field">
              <label class="field__label" for="password">New password</label>
              <input id="password" class="input" type="password" formControlName="password" autocomplete="new-password" />
              @if (form.controls.password.touched && form.controls.password.invalid) {
                <span class="field__error">Passwords must be at least 8 characters.</span>
              }
            </div>
            <div class="field">
              <label class="field__label" for="confirm">Repeat it</label>
              <input id="confirm" class="input" type="password" formControlName="confirm" autocomplete="new-password" />
              @if (form.touched && form.hasError('mismatch')) {
                <span class="field__error">The two passwords don't match.</span>
              }
            </div>

            @if (error(); as message) {
              <p class="field__error" role="alert">{{ message }}</p>
            }

            <button type="submit" class="btn btn--primary btn--block" [disabled]="busy()">
              {{ busy() ? 'Saving…' : 'Save new password' }}
            </button>
          </form>
        }
      </div>
    </main>
  `,
  styles: [
    `
      .reset { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--plane); }
      .reset__card { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 20px; }
    `,
  ],
})
export class ResetPasswordComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly checking = signal(true);
  readonly hasSession = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirm: ['', Validators.required],
    },
    { validators: matching },
  );

  async ngOnInit(): Promise<void> {
    await this.auth.whenReady();
    this.hasSession.set(this.auth.isAuthenticated());
    this.checking.set(false);
  }

  async submit(): Promise<void> {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    const result = await this.auth.updatePassword(this.form.controls.password.value);
    this.busy.set(false);

    if (!result.ok) {
      this.error.set(result.message ?? 'Could not save the new password.');
      return;
    }
    this.toast.success('Password updated');
    await this.router.navigateByUrl('/dashboard');
  }
}

function matching(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirm')?.value;
  return password && confirm && password !== confirm ? { mismatch: true } : null;
}
