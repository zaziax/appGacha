/** Preserve the meaning of short answers without adding another user-facing step. */
export function formatRequirementAnswers(
  answers: ReadonlyArray<{ question: string; answer: string }>,
  delegatedAnswer: string,
  lang: 'zh' | 'en'
): string {
  return answers.filter(item => item.answer.trim() && item.answer !== delegatedAnswer)
    .map(item => lang === 'zh'
      ? `问题：${item.question}\n回答：${item.answer}`
      : `Question: ${item.question}\nAnswer: ${item.answer}`)
    .join('\n\n')
}
