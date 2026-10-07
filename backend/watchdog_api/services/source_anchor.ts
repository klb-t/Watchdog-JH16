import { createHash } from 'node:crypto';
import { AutomationError } from '../db/repositories/automation';
import type { SourceAnchor } from '../../../shared/research';

/**
 * Binds a quote to its exact, unique position in a document. Pure text work,
 * kept apart from paper intake so the comparison and operation services —
 * which feed numbers — do not import the assistant/LLM layer just to anchor a
 * quote (principles guard, numerical-path check).
 */
export function anchorQuote(text: string, quote: string): SourceAnchor {
  const start = text.indexOf(quote);
  if (start < 0) throw new AutomationError('A proposed source quote does not occur in the supplied document');
  if (text.indexOf(quote, start + 1) >= 0) throw new AutomationError('A proposed quote is ambiguous; a longer unique span is required');
  return { quote, startUtf16: start, endUtf16: start + quote.length, textHash: createHash('sha256').update(text).digest('hex') };
}
