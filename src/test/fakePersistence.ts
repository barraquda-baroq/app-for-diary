// テスト用の保存先（何も保存しない）。必要な操作だけ差し替えて使う。NS の src/test/fakePersistence.ts を DS の口に合わせた。
import type { Persistence, SaveOutcome } from '../db/persistence'
import { emptyData } from '../domain/types'

export const emptyOutcome = (): SaveOutcome => ({ merged: {}, dropped: {}, written: [], extra: [] })

export function fakePersistence(over: Partial<Persistence> = {}): Persistence {
  return {
    load: async () => emptyData(),
    save: async () => emptyOutcome(),
    replaceAll: async () => emptyData(),
    applyRemote: async () => [],
    readOutbox: async () => [],
    completeUpload: async () => {},
    markUnconfirmed: async () => {},
    unconfirmedTx: async () => new Set(),
    confirmLanded: async () => {},
    outboxCount: async () => 0,
    outboxKeys: async () => new Set(),
    markAllDirty: async () => {},
    localKeys: async () => new Set(),
    getMeta: async () => undefined,
    setMeta: async () => {},
    setAuthoritativeFrom: async () => true,
    finishAuthoritative: async () => true,
    goneKeys: async () => new Set(),
    packsOf: async () => new Map(),
    setPacks: async () => {},
    clearPacks: async () => {},
    dropMissing: async () => [],
    close: () => {},
    ...over,
  }
}
