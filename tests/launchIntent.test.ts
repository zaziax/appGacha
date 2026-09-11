import { describe, expect, it } from 'vitest'
import { eggLaunchId } from '../src/main/launchIntent'

describe('eggLaunchId', () => {
  it('recognizes a desktop egg shortcut among Electron arguments', () => {
    expect(eggLaunchId(['AppGacha.exe', '--flag', 'appgacha://egg/ABC-123'])).toBe('abc-123')
  })

  it('does not treat other deep links or malformed ids as egg shortcuts', () => {
    expect(eggLaunchId(['appgacha://callback?code=secret'])).toBeNull()
    expect(eggLaunchId(['appgacha://egg/../../bad'])).toBeNull()
    expect(eggLaunchId([])).toBeNull()
  })
})
