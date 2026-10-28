import Link from 'next/link';
import { ArrowRight } from '@/components/icons';

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col items-start px-6 py-32">
      <p className="text-[13px] text-fg-3">404</p>
      <h1 className="mt-3 text-[32px] font-semibold tracking-[-0.02em]">Nothing at this address</h1>
      <p className="mt-3 max-w-[460px] text-[16px] text-fg-2">
        The page moved or never existed. The documentation is the best place to start.
      </p>
      <Link
        href="/docs"
        className="mt-8 inline-flex items-center gap-2 rounded-pill bg-white px-5 py-3 text-[15px] font-medium text-black transition-transform duration-150 active:scale-[0.96]"
      >
        Read the docs
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}
