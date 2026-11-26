import { useState, type ReactNode } from 'react';

interface Props {
  title: string;
  /** Lo que se ve al lado del título aunque el panel esté cerrado (la cuenta de avisos). */
  badge?: ReactNode;
  /** Abierto al montar (por defecto, sí). Después lo decide el usuario. */
  defaultOpen?: boolean;
  /** Al abrir o cerrar: el historial carga recién cuando se abre. */
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}

/** Un panel plegable debajo del editor. <details> nativo: teclado, foco y estado abierto/cerrado sin código propio. */
export function ToolPanel({ title, badge, defaultOpen = true, onToggle, children }: Props) {
  // Solo el valor inicial: si `open` siguiera a una prop que cambia, React cerraría el panel bajo el foco del usuario.
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
