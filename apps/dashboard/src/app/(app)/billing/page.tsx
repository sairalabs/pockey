import { CreditCard, Download, ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Table, Td, Th } from '@/components/ui/table';
import { formatDate, formatInt, formatUsd } from '@/lib/format';
import { billing } from '@/lib/mock-data';

export const metadata: Metadata = { title: 'Billing' };

export default function BillingPage() {
  // TODO(T5.4): read the Stripe customer, meters and invoices from the admin API.
  const period = `${formatDate(billing.currentPeriodStart)} to ${formatDate(billing.currentPeriodEnd)}`;

  return (
    <div className="stagger flex flex-col gap-6">
      <PageHeader
        title="Billing"
        description="Usage-based, no flat plan. You pay for what your users do."
        actions={<Button iconEnd={<ExternalLink strokeWidth={2} />}>Manage in Stripe</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card accent>
          <p className="text-[13px] text-fg-2">Current period estimate</p>
          <p className="mt-1.5 text-2xl font-medium leading-none num">
            {formatUsd(billing.estimateUsd)}
          </p>
          <p className="mt-3 text-[13px] text-fg-3">{period}</p>
        </Card>
        <Card accent>
          <p className="text-[13px] text-fg-2">Payment method</p>
          {billing.paymentMethod ? (
            <>
              <p className="mt-1.5 flex items-center gap-2 text-2xl font-medium leading-none">
                <CreditCard className="size-5 text-fg-2" strokeWidth={2} />
                <span className="num">
                  {billing.paymentMethod.brand} {billing.paymentMethod.last4}
                </span>
              </p>
              <p className="mt-3 text-[13px] text-fg-3 num">Expires {billing.paymentMethod.exp}</p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-fg-2">No card on file.</p>
          )}
        </Card>
      </div>

      <Card flush>
        <p className="px-5 pt-5 text-sm font-medium">This period</p>
        <Table className="mt-2">
          <thead>
            <tr>
              <Th>Meter</Th>
              <Th className="text-right">Quantity</Th>
              <Th className="text-right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {billing.lines.map((line) => (
              <tr key={line.label}>
                <Td>{line.label}</Td>
                <Td className="text-right text-fg-2 num">
                  {formatInt(line.quantity)} {line.unit}
                </Td>
                <Td className="text-right num">{formatUsd(line.amountUsd)}</Td>
              </tr>
            ))}
            <tr>
              <Td className="font-medium">Estimated total</Td>
              <Td />
              <Td className="text-right font-medium num">{formatUsd(billing.estimateUsd)}</Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      <Card flush>
        <p className="px-5 pt-5 text-sm font-medium">Invoices</p>
        <Table className="mt-2">
          <thead>
            <tr>
              <Th>Period</Th>
              <Th>Issued</Th>
              <Th>Status</Th>
              <Th className="text-right">Amount</Th>
              <Th className="w-12">
                <span className="sr-only">Download</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {billing.invoices.map((invoice) => (
              <tr key={invoice.id}>
                <Td className="font-medium">{invoice.period}</Td>
                <Td className="text-fg-2">{formatDate(invoice.issuedAt)}</Td>
                <Td>
                  <Badge tone={invoice.status === 'paid' ? 'neutral' : 'accent'}>
                    {invoice.status === 'paid' ? 'Paid' : 'Open'}
                  </Badge>
                </Td>
                <Td className="text-right num">{formatUsd(invoice.amountUsd)}</Td>
                <Td className="text-right">
                  <IconButton aria-label={`Download invoice ${invoice.period}`} size="sm">
                    <Download strokeWidth={1.5} />
                  </IconButton>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
