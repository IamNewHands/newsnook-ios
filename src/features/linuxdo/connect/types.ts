export interface LinuxDoTrustMetric {
  label: string
  current: number
  target: number
  currentText: string
  targetText: string
  met: boolean
}

export interface LinuxDoTrustVeto {
  label: string
  description?: string
  value: number
  valueText: string
  met: boolean
}

export interface LinuxDoTrustLevelData {
  title: string
  targetLevel: number
  username: string
  periodLabel: string
  achieved: boolean
  statusLabel: string
  activity: LinuxDoTrustMetric[]
  participation: LinuxDoTrustMetric[]
  compliance: LinuxDoTrustMetric[]
  vetoes: LinuxDoTrustVeto[]
  footnote?: string
  resultText: string
  fetchedAt: number
}

export type LinuxDoConnectErrorKind =
  | 'auth-required'
  | 'account-mismatch'
  | 'network'
  | 'parse'
  | 'unsupported'
  | 'rate-limited'

export class LinuxDoConnectError extends Error {
  readonly kind: LinuxDoConnectErrorKind
  readonly status?: number

  constructor(kind: LinuxDoConnectErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'LinuxDoConnectError'
    this.kind = kind
    this.status = status
  }
}
