import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Mail, ArrowLeft, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { shelf } from '../shelf'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

type Step = 'choose' | 'email' | 'code' | 'password' | 'setPassword' | 'resetPwd'

export function LoginDialog({ open, onClose, onSuccess }: Props) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>('choose')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  const reset = () => {
    setStep('choose')
    setEmail('')
    setCode('')
    setPassword('')
    setConfirmPwd('')
    setError('')
    setLoading(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSendCode = async () => {
    if (!email.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      await shelf.sendCode(email.trim())
      setStep('code')
      setCooldown(60)
      const timer = setInterval(() => {
        setCooldown(v => {
          if (v <= 1) { clearInterval(timer); return 0 }
          return v - 1
        })
      }, 1000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (!code.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await shelf.verifyCode(email.trim(), code.trim())
      if (res.hasPassword) {
        onSuccess()
        handleClose()
      } else {
        // 首次登录，引导设置密码
        setStep('setPassword')
        setPassword('')
        setConfirmPwd('')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleSetPassword = async () => {
    if (password.length < 8) { setError(t('login.pwdTooShort')); return }
    if (password !== confirmPwd) { setError(t('login.pwdMismatch')); return }
    setLoading(true)
    setError('')
    try {
      await shelf.setPassword(password)
      onSuccess()
      handleClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleSkipPassword = () => {
    onSuccess()
    handleClose()
  }

  const handleGoogle = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await shelf.authLogin()
      if (!res.ok && res.error) setError(res.error)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordLogin = async () => {
    if (!email.trim() || !password || loading) return
    setLoading(true)
    setError('')
    try {
      await shelf.loginPassword(email.trim(), password)
      onSuccess()
      handleClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleResetSendCode = async () => {
    if (!email.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      await shelf.sendCode(email.trim())
      setCooldown(60)
      const timer = setInterval(() => {
        setCooldown(v => {
          if (v <= 1) { clearInterval(timer); return 0 }
          return v - 1
        })
      }, 1000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (password.length < 8) { setError(t('login.pwdTooShort')); return }
    if (password !== confirmPwd) { setError(t('login.pwdMismatch')); return }
    if (code.length < 6 || loading) return
    setLoading(true)
    setError('')
    try {
      await shelf.resetPassword(email.trim(), code, password)
      // 重置成功，回到密码登录步骤
      setStep('password')
      setCode('')
      setPassword('')
      setConfirmPwd('')
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const dialogTitle = step === 'choose' ? t('login.title')
    : step === 'email' ? t('login.emailTitle')
    : step === 'code' ? t('login.codeTitle')
    : step === 'password' ? t('login.passwordMethod')
    : step === 'resetPwd' ? t('login.forgotPwd')
    : t('login.setPwd')

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            className="w-[340px] bg-[#fffdf9] rounded-2xl shadow-[0_16px_48px_rgba(60,40,10,0.18)] border border-[#e8dfd4] p-6"
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2 mb-5">
              {step !== 'choose' && (
                <button onClick={() => { setStep('choose'); setError('') }}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#f0e8dc] text-[#8c7b6a]">
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <h2 className="text-[15px] font-extrabold text-[#3d2c1e]">
                {dialogTitle}
              </h2>
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>
            )}

            {/* Step: Choose */}
            {step === 'choose' && (
              <div>
                <button
                  onClick={handleGoogle}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl border-2 border-[#d7c9b9] bg-white hover:border-[#bda98f] hover:bg-[#fffaf3] transition-all text-center disabled:opacity-50 shadow-[0_3px_0_rgba(92,64,51,0.12)] active:translate-y-0.5 active:shadow-none"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin text-[#8c7b6a]" /> : <GoogleIcon />}
                  <span className="text-[13px] font-extrabold text-[#3d2c1e]">{t('login.googleMethod')}</span>
                </button>

                <div className="my-4 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-[#e8dfd4]" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#a89c8c]">{t('login.or')}</span>
                  <span className="h-px flex-1 bg-[#e8dfd4]" />
                </div>

                <button
                  onClick={() => setStep('email')}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-[#f3ece3] hover:bg-[#ece1d4] transition-colors text-center"
                >
                  <Mail className="w-4 h-4 text-[#8c7b6a]" />
                  <span className="text-[12px] font-bold text-[#5a4636]">{t('login.continueEmail')}</span>
                </button>
              </div>
            )}

            {/* Step: Email input */}
            {step === 'email' && (
              <div className="space-y-4">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSendCode()}
                  placeholder={t('login.emailPlaceholder')}
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-[#e8dfd4] focus:border-[#c4a97d] outline-none text-[13px] text-[#3d2c1e] placeholder-[#b3a794] bg-white transition-colors"
                />
                <button
                  onClick={handleSendCode}
                  disabled={loading || !email.trim()}
                  className="w-full py-2.5 rounded-xl bg-[#3d2c1e] text-white text-[13px] font-bold hover:bg-[#5a4232] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('login.sendCode')}
                </button>
                <button onClick={() => { setStep('password'); setError('') }}
                  className="w-full text-center text-xs font-semibold text-[#8c7b6a] hover:text-[#3d2c1e] transition-colors">
                  {t('login.usePassword')}
                </button>
              </div>
            )}

            {/* Step: Code input */}
            {step === 'code' && (
              <div className="space-y-4">
                <p className="text-xs text-[#8c7b6a]">{t('login.codeSentTo', { email })}</p>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => e.key === 'Enter' && handleVerify()}
                  placeholder="000000"
                  autoFocus
                  maxLength={6}
                  className="w-full px-4 py-3 rounded-xl border-2 border-[#e8dfd4] focus:border-[#c4a97d] outline-none text-center text-[22px] font-bold tracking-[8px] text-[#3d2c1e] placeholder-[#ddd5c8] bg-white transition-colors"
                />
                <button
                  onClick={handleVerify}
                  disabled={loading || code.length < 6}
                  className="w-full py-2.5 rounded-xl bg-[#3d2c1e] text-white text-[13px] font-bold hover:bg-[#5a4232] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('login.verify')}
                </button>
                <button
                  onClick={handleSendCode}
                  disabled={cooldown > 0 || loading}
                  className="w-full text-center text-xs text-[#a89c8c] hover:text-[#8c7b6a] disabled:opacity-40 transition-colors"
                >
                  {cooldown > 0 ? t('login.resendIn', { s: cooldown }) : t('login.resend')}
                </button>
              </div>
            )}

            {/* Step: Password login */}
            {step === 'password' && (
              <div className="space-y-4">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t('login.emailPlaceholder')}
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-[#e8dfd4] focus:border-[#c4a97d] outline-none text-[13px] text-[#3d2c1e] placeholder-[#b3a794] bg-white transition-colors"
                />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                  placeholder={t('login.passwordPlaceholder')}
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-[#e8dfd4] focus:border-[#c4a97d] outline-none text-[13px] text-[#3d2c1e] placeholder-[#b3a794] bg-white transition-colors"
                />
                <button
                  onClick={handlePasswordLogin}
                  disabled={loading || !email.trim() || !password}
                  className="w-full py-2.5 rounded-xl bg-[#3d2c1e] text-white text-[13px] font-bold hover:bg-[#5a4232] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('login.passwordLogin')}
                </button>
                <button
                  onClick={() => { setStep('resetPwd'); setError(''); setCode(''); setPassword(''); setConfirmPwd('') }}
                  className="w-full text-center text-xs text-[#a89c8c] hover:text-[#8c7b6a] transition-colors"
                >
                  {t('login.forgotPwd')}
                </button>
                <button onClick={() => { setStep('email'); setError(''); setPassword('') }}
                  className="w-full text-center text-xs font-semibold text-[#8c7b6a] hover:text-[#3d2c1e] transition-colors">
                  {t('login.useCode')}
                </button>
              </div>
            )}

            {/* Step: Reset password (forgot) */}
            {step === 'resetPwd' && (
              <div className="space-y-4">
                <p className="text-xs text-[#8c7b6a]">{t('login.resetHint')}</p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={t('login.emailPlaceholder')}
                    autoFocus
                    className="min-w-0 flex-1 px-4 py-2.5 rounded-xl border-2 border-[#e8dfd4] focus:border-[#c4a97d] outline-none text-[13px] text-[#3d2c1e] placeholder-[#b3a794] bg-white transition-colors"
                  />
                  <button
                    onClick={handleResetSendCode}
                    disabled={loading || cooldown > 0 || !email.trim()}
                    className="shrink-0 px-3 py-2.5 rounded-xl border-2 border-[#e8dfd4] text-xs font-bold text-[#3d2c1e] hover:bg-[#faf6ef] transition-colors disabled:opacity-40"
                  >
                    {cooldown > 0 ? t('login.resendIn', { s: cooldown }) : t('login.sendCode')}
                  </button>
                </div>
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full px-4 py-3 rounded-xl border-2 border-[#e8dfd4] focus:border-[#c4a97d] outline-none text-center text-[22px] font-bold tracking-[8px] text-[#3d2c1e] placeholder-[#ddd5c8] bg-white transition-colors"
                />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('login.newPwdPlaceholder')}
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-[#e8dfd4] focus:border-[#c4a97d] outline-none text-[13px] text-[#3d2c1e] placeholder-[#b3a794] bg-white transition-colors"
                />
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={e => setConfirmPwd(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleResetPassword()}
                  placeholder={t('login.confirmPwdPlaceholder')}
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-[#e8dfd4] focus:border-[#c4a97d] outline-none text-[13px] text-[#3d2c1e] placeholder-[#b3a794] bg-white transition-colors"
                />
                <button
                  onClick={handleResetPassword}
                  disabled={loading || code.length < 6 || password.length < 8 || !confirmPwd}
                  className="w-full py-2.5 rounded-xl bg-[#3d2c1e] text-white text-[13px] font-bold hover:bg-[#5a4232] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('login.resetPwdBtn')}
                </button>
              </div>
            )}

            {/* Step: Set password (first login guidance) */}
            {step === 'setPassword' && (
              <div className="space-y-4">
                <p className="text-xs text-[#8c7b6a]">{t('login.setPwdHint')}</p>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('login.newPwdPlaceholder')}
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-[#e8dfd4] focus:border-[#c4a97d] outline-none text-[13px] text-[#3d2c1e] placeholder-[#b3a794] bg-white transition-colors"
                />
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={e => setConfirmPwd(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSetPassword()}
                  placeholder={t('login.confirmPwdPlaceholder')}
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-[#e8dfd4] focus:border-[#c4a97d] outline-none text-[13px] text-[#3d2c1e] placeholder-[#b3a794] bg-white transition-colors"
                />
                <button
                  onClick={handleSetPassword}
                  disabled={loading || password.length < 8 || !confirmPwd}
                  className="w-full py-2.5 rounded-xl bg-[#3d2c1e] text-white text-[13px] font-bold hover:bg-[#5a4232] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('login.setPwd')}
                </button>
                <button
                  onClick={handleSkipPassword}
                  className="w-full text-center text-xs text-[#a89c8c] hover:text-[#8c7b6a] transition-colors"
                >
                  {t('login.skipPwd')}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function GoogleIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}
