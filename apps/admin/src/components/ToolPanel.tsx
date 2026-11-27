import { useState, type ReactNode } from 'react';

interface Props {
  title: string;
  /** What shows next to the title even when the panel is closed (the warning count). */
  badge?: ReactNode;
  /** Open on mount (yes by default). After that the user decides. */
  defaultOpen?: boolean;
  /** On open or close: the history only loads when opened. */
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}

/** A collapsible panel below the editor. Native <details>: keyboard, focus and open/closed state without own code. */
export function ToolPanel({ title, badge, defaultOpen = true, onToggle, children }: Props) {
  // Only the initial value: if `open` followed a changing prop, React would close the panel under the user's focus.
  const [initiallyOpen] = useState(defaultOpen);
  return (
    <details
      className="tool-panel"
      open={initiallyOpen}
      onToggle={onToggle && ((event) => onToggle(event.currentTarget.open))}
    >
      <summary className="tool-panel-summary">
        <span className="label">{title}</span>
        {badge}
      </summary>
      <div className="tool-panel-body">{children}</div>
    </details>
  );
}
