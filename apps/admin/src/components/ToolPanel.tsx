import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** Lo que se ve al lado del título aunque el panel esté cerrado (la cuenta de avisos). */
  badge?: ReactNode;
  children: ReactNode;
}

/** Un panel plegable debajo del editor. <details> nativo: teclado, foco y estado abierto/cerrado sin código propio. */
export function ToolPanel({ title, badge, children }: Props) {
  return (
    <details className="tool-panel" open>
      <summary className="tool-panel-summary">
        <span className="label">{title}</span>
        {badge}
      </summary>
      <div className="tool-panel-body">{children}</div>
    </details>
  );
}
