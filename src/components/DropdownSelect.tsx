import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

export function DropdownSelect({
  value,
  onChange,
  options,
  className = '',
  prefix,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  className?: string
  prefix?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value) ?? options[0]

  function closeOnBlur(event: React.FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setOpen(false)
  }

  return (
    <div className={`dropdown-select ${open ? 'open' : ''} ${className}`} tabIndex={-1} onBlur={closeOnBlur}>
      <button type="button" className="dropdown-trigger" onClick={() => setOpen((current) => !current)}>
        {prefix && <span className="dropdown-prefix">{prefix}</span>}
        <span className="dropdown-value">{selected?.label}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="dropdown-menu">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === value ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
