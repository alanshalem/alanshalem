import { useId, type ComponentProps, type ReactNode } from 'react';
import { HeroImageForm } from './HeroImageForm.tsx';

type FormProps = ComponentProps<typeof HeroImageForm>;

interface Props extends Omit<FormProps, 'head' | 'labelledBy' | 'onDirtyChange' | 'doneText'> {
  title: string;
  /** Short status next to the title (unsaved files). */
  badge?: { text: string; tone?: 'error' } | undefined;
  /** Short summary of the item (a video's trim and fade). */
  summary?: string | undefined;
  /** Thumbnail or, for a video not uploaded yet, the trim editor (the card becomes one column). */
  thumbnail: ReactNode;
}

/**
 * A hero file in progress (photo or video): thumbnail (or the trim editor), its status and the text form
 * (HeroImageForm, the same as the side panel of a saved item). Saved items show in the grid.
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
