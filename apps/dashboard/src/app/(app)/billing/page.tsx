import type { Metadata } from 'next';
import { LoginScreen } from '@/components/auth/login-screen';
import { BillingView } from '@/components/billing/billing-view';
import { fetchBilling, tryFetch } from '@/lib/api.server';

export const metadata: Metadata = { title: 'Billing' };

export default async function BillingPage() {
  const billing = await tryFetch(fetchBilling);
  if (!billing.ok) return <LoginScreen />;
  return <BillingView billing={billing.data} />;
}
