/** Small JSON readers used at external HTTP response boundaries. */

/** A JSON object after runtime narrowing. */
export type JsonRecord = Record<string, unknown>

/** Return an object record, excluding arrays and null. */
export function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

/** Read an array field. */
export function readArray(record: JsonRecord, key: string): readonly unknown[] | undefined {
  const value = record[key]
  return Array.isArray(value) ? value : undefined
}

/** Read a string field, including the empty string. */
export function readString(record: JsonRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/** Read a trimmed, non-empty string field. */
export function readNonBlankString(record: JsonRecord, key: string): string | undefined {
  const value = readString(record, key)?.trim()
  return value === undefined || value.length === 0 ? undefined : value
}

/** Read a boolean field. */
export function readBoolean(record: JsonRecord, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

/** Read a finite number field. */
export function readNumber(record: JsonRecord, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
