import { useEffect, useState } from 'react'
import { fmt } from '../format'

interface Props {
  value: number
  onChange: (v: number) => void
  step?: number
  label?: string
  className?: string
  autoFocus?: boolean
  onDone?: () => void
}

/** Number input that lets you type intermediate text ("-", "0.") and only
 *  commits parseable values. */
export function NumberField({ value, onChange, step = 0.1, label, className, autoFocus, onDone }: Props) {
  const [text, setText] = useState(fmt(value))

  useEffect(() => {
    if (Number(text) !== value) setText(fmt(value))
  }, [value])

  return (
    <input
      className={`num ${className ?? ''}`}
      type="number"
      inputMode="decimal"
      step={step}
      value={text}
      aria-label={label}
      autoFocus={autoFocus}
      onChange={(e) => {
        setText(e.target.value)
        const v = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(v)) onChange(v)
      }}
      onBlur={() => {
        setText(fmt(value))
        onDone?.()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}
