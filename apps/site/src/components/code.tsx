import { tokenColour, tokenizeCode } from '@/lib/highlight';

interface CodeProps {
  code: string;
  lang?: string;
  /** A filename or a shell prompt, shown above the block. */
  label?: string;
}

/**
 * Code in the site font, like everywhere else in Pockey. Alignment is carried
 * by `white-space: pre` and tabular figures rather than by a monospace face.
 */
export function Code({ code, lang = 'tsx', label }: CodeProps) {
  return (
    <div className="overflow-hidden rounded-card bg-surface">
      {label ? <div className="bg-surface-2 px-5 py-2.5 text-[13px] text-fg-2">{label}</div> : null}
      <pre className="code-face overflow-x-auto px-5 py-5 text-[13.5px] leading-[1.7] text-fg-2">
        <code>
          {tokenizeCode(code, lang).map((token, index) => {
            const colour = tokenColour(token.cls);
            return colour ? (
              <span key={index} style={{ color: colour }}>
                {token.text}
              </span>
            ) : (
              <span key={index}>{token.text}</span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
