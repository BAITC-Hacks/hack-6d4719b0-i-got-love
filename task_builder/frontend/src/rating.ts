import rules from '../../../backend/rating_rules.json';

const criteria: Record<string, Record<string, number>> = {
  context_and_need: { context: 10, need: 10 }, data: { data: 20 }, expected_result: { expected_result: 15 },
  success_criteria: { success_criteria: 15 }, constraints: { constraints: 10 }, users: { users: 10 },
  business_contact: { contact: 5, interaction_format: 5 },
};
// Mirrors backend/rating.py; this checks readable structure, not factual accuracy.
function readableWords(value: string) {
  return (value.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ').match(/\p{L}+/gu) ?? []).filter(word => {
    if (Array.from(word).length < 2 || rules.placeholder_words.includes(word)) return false;
    if (rules.placeholder_words.some(base => word.length % base.length === 0 && base.repeat(word.length / base.length) === word)) return false;
    if ([1, 2, 3].some(size => word.length >= size * 3 && word.length % size === 0 && word.slice(0, size).repeat(word.length / size) === word)) return false;
    return !/^[a-zа-яё]+$/.test(word) || /[aeiouyаеёиоуыэюя]/.test(word) || rules.allowed_acronyms.includes(word);
  });
}
export function fieldIssue(name: string, value: string): string | null {
  const text = value.trim();
  if (!text) return rules.empty_reason;
  const words = readableWords(text);
  if (name === 'contact') {
    if (/^[^@\s]+@(?:[\p{L}\p{N}_-]+\.)+[\p{L}\p{N}_-]{2,}$/u.test(text)) return null;
    const digits = text.match(/\p{Nd}/gu) ?? [];
    if (/^\+?[\p{Nd}()\s.\-]+$/u.test(text) && digits.length >= 7 && digits.length <= 15 && new Set(digits).size > 1) return null;
    if (/^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(text) && words.length) return null;
    try {
      const url = new URL(text);
      if (/^https?:\/\//i.test(text) && ['http:', 'https:'].includes(url.protocol) && url.hostname && !text.split('/')[2]?.includes('@') && !/[\s\x00-\x1f\\]/.test(text)) return null;
    } catch { /* A contact can still be a person's name. */ }
    return new Set(words).size >= rules.min_distinct_words && text.split(/\s+/).length >= 2 && /^\p{L}+(?:[\s'’-]\p{L}+)+$/u.test(text) ? null : rules.contact_reason;
  }
  if (!words.length) return rules.placeholder_reason;
  return new Set(words).size < rules.min_distinct_words || words.reduce((total, word) => total + Array.from(word).length, 0) < rules.min_letters ? rules.detail_reason : null;
}
export function evaluatePreview(task: Record<string, unknown>) {
  const result = { score: 0, level: 'draft', score_breakdown: {} as Record<string, { earned: number; max: number }>, missing_fields: [] as string[], field_issues: {} as Record<string, string> };
  for (const [criterion, parts] of Object.entries(criteria)) {
    let earned = 0; let max = 0;
    for (const [field, weight] of Object.entries(parts)) {
      max += weight;
      const issue = fieldIssue(field, String(task[field] ?? ''));
      if (issue) { result.missing_fields.push(field); result.field_issues[field] = issue; }
      else earned += weight;
    }
    result.score += earned; result.score_breakdown[criterion] = { earned, max };
  }
  result.level = result.score < 40 ? 'draft' : result.score < 70 ? 'working' : result.score < 90 ? 'ready' : 'priority';
  return result;
}
