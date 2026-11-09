import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { IconCaret } from '../icons';

export interface IconSelectOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  hint?: string;
}

// A compact dropdown, a native select cannot carry an icon.
export function IconSelect<T extends string>({
  value,
  options,
  onChange,
  icon,
  title
}: {
  value: T;
  options: IconSelectOption<T>[];
  onChange: (value: T) => void;
  icon?: ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const choose = (option: IconSelectOption<T>): void => {
    onChange(option.value);
    setOpen(false);
  };

  return (
    <div className="icon-select" ref={rootRef}>
      <button
        className={'icon-select-trigger' + (open ? ' open' : '')}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {icon}
        <span className="icon-select-label">{current?.label}</span>
        <IconCaret />
      </button>
      {open ? (
        <div className="icon-select-menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              className={'icon-select-option' + (option.value === value ? ' active' : '')}
              role="option"
              aria-selected={option.value === value}
              title={option.hint}
              onClick={() => choose(option)}
            >
              {option.icon}
              <span className="icon-select-label">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

