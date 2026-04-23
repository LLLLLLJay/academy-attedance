export type Mode = 'in' | 'out'

export type Screen = 'main' | 'keypad' | 'select' | 'done' | 'notfound' | 'cooldown'

export type KioskStudent = {
  name: string
  grade: string
  classroom: string
}

export type KioskParent = {
  name: string
  phone_last4: string
}

export type KioskMatch = {
  student: KioskStudent
  parent: KioskParent
}

export type CooldownInfo = {
  student: KioskStudent
  remainMin: number
}
