export type Mode = 'in' | 'out'

export type Screen = 'main' | 'keypad' | 'select' | 'done' | 'notfound' | 'cooldown'

export type KioskStudent = {
  // API가 MULTIPLE 응답에서 student id를 돌려줘 두 번째 호출에 같이 실어 보내야 한다.
  id?: string
  name: string
  // grade/classroom은 현재 DB 스키마에 없는 mock-only 필드 → 옵셔널로 두고
  // SelectScreen에서 값이 있을 때만 렌더한다 (스키마에 컬럼이 추가되면 채워 넣게).
  grade?: string
  classroom?: string
}

export type KioskParent = {
  name: string
  phone_last4: string
}

export type KioskMatch = {
  student: KioskStudent
  // 부모 식별 정보도 API MULTIPLE 응답엔 아직 없다 → 옵셔널.
  parent?: KioskParent
}

export type CooldownInfo = {
  student: KioskStudent
  remainMin: number
}
