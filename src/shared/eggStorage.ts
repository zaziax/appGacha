export interface EggStorageStatus {
  directory: string
  defaultDirectory: string
  pending?: { directory: string; copyExisting: boolean }
  error?: string
  /** False means no library is loaded; Settings remains available for recovery. */
  available: boolean
  configBackup?: string
}
