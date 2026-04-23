export function DoorInIcon({ size = 40, stroke = 2.2 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none"
      stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M26 7 H33 V33 H26" />
      <path d="M8 20 H26" />
      <path d="M20 14 L26 20 L20 26" />
    </svg>
  )
}

export function DoorOutIcon({ size = 40, stroke = 2.2 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none"
      stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M26 7 H33 V33 H26" />
      <path d="M8 20 H26" />
      <path d="M14 14 L8 20 L14 26" />
    </svg>
  )
}
