import { useId, type ComponentProps, type ReactNode } from 'react';
import { HeroImageForm } from './HeroImageForm.tsx';

type FormProps = ComponentProps<typeof HeroImageForm>;

interface Props extends Omit<FormProps, 'head' | 'labelledBy' | 'onDirtyChange' | 'doneText'> {
  title: string;
  /** Estado corto junto al título (archivos sin guardar). */
  badge?: { text: string; tone?: 'error' } | undefined;
  /** Resumen corto del ítem (el recorte y el fundido de un video). */
  summary?: string | undefined;
  /** Miniatura o, para un video sin subir, el editor de recorte (la tarjeta pasa a una columna). */
  thumbnail: ReactNode;
}

/**
 * Un archivo en curso del hero (foto o video): miniatura (o el editor de recorte), su estado y el formulario de textos
 * (HeroImageForm, el mismo del panel lateral de un ítem guardado). Los ítems guardados se ven en la grilla (U7).
 */
export function HeroImageCard({ title, badge, summary, thumbnail, ...form }: Props) {
  const titleId = useId();
  return (
    <div className="hero-card">
      {thumbnail}
      <HeroImageForm
        {...form}
        labelledBy={titleId}
        head={
          <>
            <div className="hero-card-head">
              <h3 id={titleId} className="label hero-card-title">
                {title}
              </h3>
              {badge && <span className={badge.tone === 'error' ? 'chip chip-error' : 'chip'}>{badge.text}</span>}
            </div>
            {summary && <p className="chip hero-card-summary">{summary}</p>}
          </>
        }
      />
    </div>
  );
}
