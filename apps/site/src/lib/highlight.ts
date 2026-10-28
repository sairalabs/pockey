/**
 * A small colouring pass for the code shown on the site. It is deliberately
 * approximate: five token classes, no parser, no dependency. Anything it is
 * unsure about stays the body colour, which is the readable failure.
 *
 * It returns tokens rather than markup, so the landing can render React spans
 * and the documentation can render an HTML string from the same pass.
 */

export type TokenClass = 'keyword' | 'string' | 'tag' | 'type' | 'comment' | 'plain';

export interface CodeToken {
  text: string;
  cls: TokenClass;
}

const TS_KEYWORDS =
  'import|from|export|default|function|return|const|let|var|await|async|new|if|else|for|while|type|interface|extends|implements|class|try|catch|finally|throw|typeof|as|of|in|null|undefined|true|false';

/** Order matters: comments and strings win over everything inside them. */
const PATTERNS: Record<string, RegExp> = {
  ts: new RegExp(
    [
      '(?<comment>\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
      '(?<string>\'(?:[^\'\\\\\\n]|\\\\.)*\'|"(?:[^"\\\\\\n]|\\\\.)*")',
      '(?<tag><\\/?[A-Za-z][\\w.]*)',
      `(?<keyword>\\b(?:${TS_KEYWORDS})\\b)`,
      '(?<type>\\b[A-Z][A-Za-z0-9]*\\b)',
    ].join('|'),
    'g',
  ),
  bash: new RegExp(
    [
      '(?<comment>#[^\\n]*)',
      '(?<string>\'(?:[^\'\\n])*\'|"(?:[^"\\n])*")',
      '(?<keyword>(?:^|\\s)--?[A-Za-z][\\w-]*)',
    ].join('|'),
    'g',
  ),
  json: new RegExp(
    [
      '(?<string>"(?:[^"\\\\\\n]|\\\\.)*")',
      '(?<keyword>\\b(?:true|false|null)\\b|-?\\b\\d+(?:\\.\\d+)?\\b)',
    ].join('|'),
    'g',
  ),
};

const ALIASES: Record<string, keyof typeof PATTERNS> = {
  ts: 'ts',
  tsx: 'ts',
  typescript: 'ts',
  js: 'ts',
  jsx: 'ts',
  javascript: 'ts',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  console: 'bash',
  json: 'json',
  jsonc: 'json',
};

export function tokenizeCode(code: string, lang = 'ts'): CodeToken[] {
  const pattern = PATTERNS[ALIASES[lang.toLowerCase()] ?? ''];
  if (!pattern) return [{ text: code, cls: 'plain' }];

  const tokens: CodeToken[] = [];
  let last = 0;
  // A fresh regex each call: the global flag carries lastIndex between calls.
  const re = new RegExp(pattern.source, pattern.flags);

  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    const groups = m.groups ?? {};
    const cls = (Object.keys(groups).find((k) => groups[k] !== undefined) ?? 'plain') as TokenClass;
    const matched = m[0];
    // The bash flag pattern swallows the space before the flag; give it back.
    const lead = cls === 'keyword' && /^\s/.test(matched) ? matched.slice(0, 1) : '';
    if (m.index > last) tokens.push({ text: code.slice(last, m.index), cls: 'plain' });
    if (lead) tokens.push({ text: lead, cls: 'plain' });
    tokens.push({ text: matched.slice(lead.length), cls });
    last = m.index + matched.length;
  }
  if (last < code.length) tokens.push({ text: code.slice(last), cls: 'plain' });
  return tokens;
}

const COLOURS: Record<TokenClass, string> = {
  keyword: 'var(--code-keyword)',
  string: 'var(--code-string)',
  tag: 'var(--code-tag)',
  type: 'var(--code-type)',
  comment: 'var(--code-comment)',
  plain: 'inherit',
};

export function tokenColour(cls: TokenClass): string | undefined {
  return cls === 'plain' ? undefined : COLOURS[cls];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The same pass, as markup, for the documentation renderer. */
export function highlightToHtml(code: string, lang = 'ts'): string {
  return tokenizeCode(code, lang)
    .map((token) => {
      const colour = tokenColour(token.cls);
      const text = escapeHtml(token.text);
      return colour ? `<span style="color:${colour}">${text}</span>` : text;
    })
    .join('');
}
