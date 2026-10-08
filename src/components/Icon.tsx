import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  back: <path d="M15 5 L8 12 L15 19" />,
  up: <path d="M5 15 L12 8 L19 15" />,
  down: <path d="M5 9 L12 16 L19 9" />,
  select: <path d="M5 3 L5 19 L9.5 15 L13 21 L15.5 19.8 L12.2 14 L18 14 Z" />,
  pen: (
    <>
      <path d="M4 20 L5 15 L16 4 L20 8 L9 19 Z" />
      <path d="M14 6 L18 10" />
    </>
  ),
  eraser: (
    <>
      <path d="M3.5 15.5 L12.5 6.5 L19 13 L12.5 19.5 L7.5 19.5 Z" />
      <path d="M8.5 10.5 L15 17 M12.5 19.5 L21 19.5" />
    </>
  ),
  text: <path d="M6 5 L18 5 M12 5 L12 20" />,
  image: (
    <>
      <path d="M4 5 H20 V19 H4 Z" />
      <path d="M4 16 L9 11 L13 15 L16 12 L20 16" />
      <circle cx="15.5" cy="9" r="1.5" />
    </>
  ),
  undo: <path d="M8 5 L3 10 L8 15 M3 10 H14 C18 10 20 13 20 16 C20 18 19 19 18 20" />,
  redo: <path d="M16 5 L21 10 L16 15 M21 10 H10 C6 10 4 13 4 16 C4 18 5 19 6 20" />,
  plus: <path d="M12 5 V19 M5 12 H19" />,
  wave: <path d="M4 10 V14 M8 6 V18 M12 9 V15 M16 4 V20 M20 10 V14" />,
  trash: <path d="M5 7 H19 M9 7 V4 H15 V7 M7 7 L8 20 H16 L17 7 M10 11 V16 M14 11 V16" />,
  close: <path d="M6 6 L18 18 M18 6 L6 18" />,
};

const FILLED: Record<string, ReactNode> = {
  play: <path d="M8 5 L19 12 L8 19 Z" />,
  pause: <path d="M7 5 H10 V19 H7 Z M14 5 H17 V19 H14 Z" />,
  prev: (
    <>
      <path d="M7 5 V19" />
      <path d="M19 5 L9 12 L19 19 Z" />
    </>
  ),
  next: (
    <>
      <path d="M17 5 V19" />
      <path d="M5 5 L15 12 L5 19 Z" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const filled = name in FILLED;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {filled ? FILLED[name] : PATHS[name]}
    </svg>
  );
}
