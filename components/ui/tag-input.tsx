'use client'

import { useRef, KeyboardEvent, useState } from 'react'
import { cn } from '@/lib/utils'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  className?: string
}

export default function TagInput({ value, onChange, placeholder, className }: TagInputProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function addTag(raw: string) {
    let tag = raw.trim().toLowerCase()
    // Strip r/ or R/ prefix
    tag = tag.replace(/^r\//i, '')
    if (!tag) return
    // Prevent duplicates
    if (value.some((t) => t.toLowerCase() === tag)) return
    onChange([...value, tag])
  }

  function removeTag(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const val = e.key === ',' ? text.replace(/,$/, '') : text
      addTag(val)
      setText('')
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      removeTag(value.length - 1)
    }
  }

  function handleChange(val: string) {
    // If pasting with commas, split and add
    if (val.includes(',')) {
      const parts = val.split(',')
      parts.forEach((p) => addTag(p))
      setText('')
    } else {
      setText(val)
    }
  }

  return (
    <div
      className={cn(
        'flex flex-wrap gap-1.5 items-center border border-beetle-border rounded-lg min-h-[42px] px-3 py-2 bg-white cursor-text focus-within:ring-2 focus-within:ring-beetle-orange focus-within:ring-offset-0',
        className
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag, i) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 bg-beetle-bg text-beetle-ink text-xs font-body px-2 py-0.5 rounded-md"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); removeTag(i) }}
            className="text-beetle-muted hover:text-beetle-ink ml-0.5 leading-none"
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[120px] border-none outline-none bg-transparent text-sm font-body text-beetle-ink placeholder:text-beetle-faint"
      />
    </div>
  )
}
