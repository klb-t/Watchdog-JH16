import text from '../../config/ui/source-history.json';
import { useUiText } from './ui_text';
import { configText } from './config_text';

const snake = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`).toLowerCase();

/**
 * Source-history wording in the reader's language. The served profiles
 * (config/source-history-ui.json, config/collection-ui.json) are hashed and stay as
 * stored; their Polish text is translated for display only while it equals
 * config/ui/source-history.json.
 */
export function useSourceHistoryText() {
  const ui = useUiText(text);
  const shown = (key: string, source: string) => configText(text, ui.lang, 'pl', key, source);
  return { ...ui,
    label: (key: string, source: string) => shown(`label_${snake(key)}`, source),
    transition: (code: string, source: string) => shown(`transition_${snake(code)}`, source),
    change: (kind: string, source: string) => shown(`change_${snake(kind)}`, source),
    purpose: (id: string, source: string | undefined) => source === undefined ? undefined : shown(`purpose_${snake(id)}`, source),
    collectionLabel: (source: string) => shown('collection_label', source),
  };
}
