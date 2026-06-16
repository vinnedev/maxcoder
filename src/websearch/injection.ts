// web_search — content guardrails: detect & neutralize prompt-injection in untrusted web content.
// Web content is DATA, never instructions. We flag and strip lines that try to instruct the agent.

export interface InjectionScan {
  detected: boolean
  patterns: string[]
}

const INJECTION_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'ignore_previous_instructions', re: /\bignore\s+(?:all\s+)?(?:your\s+)?previous\s+instructions\b/i },
  { label: 'disregard_above', re: /\bdisregard\s+(?:the\s+)?(?:above|previous|prior)\b/i },
  { label: 'role_override', re: /\byou\s+are\s+now\s+(?:a\s+)?(?:system|developer|admin|dan|root|different)\b/i },
  { label: 'system_prompt', re: /\bsystem\s+prompt\b/i },
  { label: 'developer_message', re: /\bdeveloper\s+message\b/i },
  { label: 'new_instructions', re: /\b(?:new|updated|real|true)\s+instructions\s*:/i },
  { label: 'exfiltration', re: /\b(?:send|reveal|print|leak|exfiltrate|output|share)\b[^.\n]{0,40}\b(?:secret|secrets|api\s*keys?|password|passwords|token|tokens|credential|credentials|env(?:ironment)?\s*variables?)\b/i },
  { label: 'command_execution', re: /\b(?:execute|run|eval)\b[^.\n]{0,30}\b(?:command|shell|code|script|bash|powershell)\b/i },
  { label: 'disable_safety', re: /\bdisable\b[^.\n]{0,30}\b(?:safety|guardrails?|filters?|moderation|protections?)\b/i },
  { label: 'copy_into_prompt', re: /\bcopy\b[^.\n]{0,30}\b(?:into|to)\b[^.\n]{0,20}\b(?:prompt|context|system|memory)\b/i },
  { label: 'jailbreak', re: /\bjailbreak\b/i },
  { label: 'override_rules', re: /\boverride\b[^.\n]{0,30}\b(?:instructions|guardrails?|rules|policy)\b/i },
  { label: 'assistant_directive', re: /\b(?:assistant|ai|model|llm)\s*[:,]?\s*(?:you\s+must|please|now)\b/i },
  { label: 'tool_injection', re: /<\/?(?:system|tool_call|function_call|assistant)\b/i },
]

/** Scan text for prompt-injection attempts. */
export function detectInjection(text: string): InjectionScan {
  if (!text) return { detected: false, patterns: [] }
  const found = new Set<string>()
  for (const { label, re } of INJECTION_PATTERNS) {
    if (re.test(text)) found.add(label)
  }
  return { detected: found.size > 0, patterns: [...found] }
}

/** Replace any line that looks like an instruction with a neutral marker. */
export function neutralizeText(text: string): string {
  if (!text) return text
  return text
    .split('\n')
    .map(line => (INJECTION_PATTERNS.some(p => p.re.test(line)) ? '[removed: untrusted instruction from web content]' : line))
    .join('\n')
}

/** Scan + neutralize a snippet/text block in one step. */
export function sanitizeContent(text: string): { clean: string; scan: InjectionScan } {
  const scan = detectInjection(text)
  return { clean: scan.detected ? neutralizeText(text) : text, scan }
}
