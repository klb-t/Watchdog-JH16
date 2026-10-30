import shared from '../../config/ui/workbench-shared.json';
import { fillText } from '../../shared/ui_text';
import { useLanguage } from './ui_text';

const en = shared.languages.en as Record<string, string>;
const keyOf = (prefix: string, code: string) => `${prefix}${code.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

/**
 * Display labels for the workbench's stored vocabulary. Profile and tier labels are part of
 * hashed configuration, so they are never rewritten: a translation is used only while the
 * bundle's English text equals the stored label exactly, and the stored label is shown
 * otherwise (an older or changed profile is never shown under a translation of other words).
 * Stored codes (approval state, visibility, join state) get a label, or are shown as stored.
 */
export function useWorkbenchText() {
  const lang = useLanguage();
  /** A stored profile label in the reader's language when an exact translation exists. */
  const stored = (key: string, text: string) => (en[key] === text ? fillText(shared, lang, key) : text);
  const code = (prefix: string, value: string) => { const key = keyOf(prefix, value); return key in en ? fillText(shared, lang, key) : value; };
  return {
    renderer: (r: { id: string; label: string }) => stored(keyOf('profile_renderer_', r.id), r.label),
    palette: (p: { id: string; label: string }) => stored(keyOf('profile_palette_', p.id), p.label),
    method: (m: { id: string; label: string }) => stored(keyOf('profile_method_', m.id), m.label),
    methodDescription: (m: { id: string; description: string }) => stored(`${keyOf('profile_method_', m.id)}_description`, m.description),
    provider: (p: { id: string; label: string }) => stored(keyOf('profile_provider_', p.id), p.label),
    notice: (providerId: string, index: number, text: string) => stored(`${keyOf('profile_notice_', providerId)}_${index}`, text),
    tier: (tier: string, label: string) => stored(keyOf('tier_', tier), label),
    approval: (state: string) => code('approval_', state),
    visibility: (value: string) => code('visibility_', value),
    regionState: (state: string) => code('region_state_', state),
  };
}
