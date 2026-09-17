import { LoginForm } from '@/components/auth/login-form';
import { githubAvailable } from '@/lib/api.server';

/**
 * Full page sign in. Rendered by `/login` and by any page that gets a 401 from
 * the admin API, so an expired session never shows a broken shell.
 */
export async function LoginScreen({ next }: { next?: string }) {
  const githubEnabled = await githubAvailable();
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <LoginForm githubEnabled={githubEnabled} {...(next === undefined ? {} : { next })} />
    </main>
  );
}
