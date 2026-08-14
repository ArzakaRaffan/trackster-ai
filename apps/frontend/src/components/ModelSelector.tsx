'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clock } from 'lucide-react';

export interface ModelOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  options: ModelOption[];
}

export default function ModelSelector({ value, onChange, options }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((opt) => opt.value === value) || options[0];

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeydown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="focus-ring field flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-medium text-foreground"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Pilih model AI"
          className="absolute right-0 z-50 mt-2 max-h-80 w-72 overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-xl shadow-black/30 focus:outline-none"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            const isDisabled = option.disabled === true;

            return (
              <li key={option.value} className="list-none">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={isDisabled}
                  tabIndex={0}
                  onClick={() => {
                    if (isDisabled) return;
                    onChange(option.value);
                    setOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      if (isDisabled) return;
                      onChange(option.value);
                      setOpen(false);
                    }
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                    isDisabled
                      ? 'cursor-not-allowed opacity-50'
                      : isSelected
                        ? 'bg-primary/10 text-foreground'
                        : 'hover:bg-hover hover:text-foreground'
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isSelected && <Check className="h-4 w-4 shrink-0 text-accent" />}
                  {isDisabled && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Segera hadir
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
