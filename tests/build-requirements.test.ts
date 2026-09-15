import { describe, expect, it } from 'vitest'
import { formatRequirementAnswers } from '../src/shared/buildRequirements'
import { generationRules } from '../src/main/generationRules'

describe('build requirements', () => {
  it('keeps the question attached to otherwise ambiguous answers', () => {
    expect(formatRequirementAnswers([{ question: 'Save after closing?', answer: 'Yes' }], 'Decide for me', 'en'))
      .toBe('Question: Save after closing?\nAnswer: Yes')
  })
  it('omits delegated choices but preserves meaningful Chinese answers', () => {
    expect(formatRequirementAnswers([{ question: '每天提醒？', answer: '是' }, { question: '颜色？', answer: '你决定' }], '你决定', 'zh'))
      .toBe('问题：每天提醒？\n回答：是')
  })
  it('makes path semantics and evidence-led repair explicit in both languages', () => {
    for (const lang of ['en', 'zh'] as const) {
      const rules = generationRules(lang)
      expect(rules).toContain('./src/store.js')
      expect(rules).toContain('../vendor/chart.esm.js')
      expect(rules).toContain('set_plan')
      expect(rules).toContain('check_egg')
    }
  })
})
