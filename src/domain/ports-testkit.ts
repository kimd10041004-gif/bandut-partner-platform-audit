/** 계약 테스트가 쓰는 타입 재export — 테스트가 platform.ts 전체를 끌어오지 않게 한다 (28-67) */
export type { SnapshotPort, SnapshotRecord, WriteResult } from './ports'
export type { StorageLike } from './platform'
