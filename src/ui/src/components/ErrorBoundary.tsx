import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { withTranslation, type WithTranslation } from 'react-i18next'

interface Props extends WithTranslation {
  children: ReactNode
  /** 自定义回退文案（缺省使用 i18n key） */
  fallbackTitle?: string
  fallbackHint?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundaryInner extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error.message, info.componentStack)
    // 后续可接入 crash report
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { t } = this.props
    const title = this.props.fallbackTitle ?? t('errorBoundary.title')
    const hint = this.props.fallbackHint ?? t('errorBoundary.hint')
    const errorMsg = this.state.error?.message ?? ''

    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f7f4ee' }}>
        <div className="text-center px-8 py-10 max-w-md">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5"
            style={{ background: '#fde8e8' }}>
            <AlertTriangle size={30} style={{ color: '#d9534f' }} />
          </div>
          <h2 className="text-lg font-bold mb-2" style={{ color: '#5c4033' }}>{title}</h2>
          <p className="text-[13px] leading-relaxed mb-5" style={{ color: '#8b7355' }}>{hint}</p>
          {errorMsg && (
            <details className="mb-5 text-left">
              <summary className="text-[11px] cursor-pointer select-none" style={{ color: '#b3a794' }}>
                {t('errorBoundary.details')}
              </summary>
              <pre className="mt-2 text-[11px] p-3 rounded-lg overflow-auto max-h-32 text-left"
                style={{ background: '#fff', color: '#8b4513', border: '1px solid #e8dfd4' }}>
                {errorMsg}
              </pre>
            </details>
          )}
          <div className="flex gap-3 justify-center">
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold
                text-white transition-colors hover:opacity-90"
              style={{ background: '#d9534f' }}
            >
              <RefreshCw size={15} />
              {t('errorBoundary.retry')}
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-colors hover:opacity-90"
              style={{ background: '#fff', color: '#5c4033', border: '2px solid #e8dfd4' }}
            >
              {t('errorBoundary.reload')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryInner)
