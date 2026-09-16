import { redirect } from 'next/navigation';

export default function IndexPage() {
  // TODO(T5.1): redirect to /login when there is no developer session.
  redirect('/apps');
}
