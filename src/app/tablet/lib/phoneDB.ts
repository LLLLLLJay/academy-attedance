import type { KioskMatch } from './types'

// 프로토타입 시드 데이터 — Supabase 연동 시
// students + student_parents WHERE phone_last4 = ? AND is_active = true 쿼리로 교체.
export const PHONE_DB: Record<string, KioskMatch[]> = {
  '1234': [
    { student: { name: '김민준', grade: '중2', classroom: '수학 A반' }, parent: { name: '엄마', phone_last4: '1234' } },
  ],
  '2580': [
    { student: { name: '이서연', grade: '중3', classroom: '영어 심화반' }, parent: { name: '엄마', phone_last4: '2580' } },
    { student: { name: '이서윤', grade: '고1', classroom: '영어 B반' }, parent: { name: '아빠', phone_last4: '2580' } },
    { student: { name: '이서준', grade: '중2', classroom: '수학 A반' }, parent: { name: '엄마', phone_last4: '2580' } },
  ],
  '0000': [
    { student: { name: '박지호', grade: '고2', classroom: '수학 심화반' }, parent: { name: '엄마', phone_last4: '0000' } },
    { student: { name: '박지후', grade: '중3', classroom: '영어 A반' }, parent: { name: '아빠', phone_last4: '0000' } },
  ],
  '7777': [
    { student: { name: '최윤아', grade: '고1', classroom: '국어 B반' }, parent: { name: '엄마', phone_last4: '7777' } },
  ],
}

export function findByPhoneLast4(last4: string): KioskMatch[] {
  return PHONE_DB[last4] ?? []
}
