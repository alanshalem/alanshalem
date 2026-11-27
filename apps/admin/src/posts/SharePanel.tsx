import { useMemo } from 'react';
import { ToolPanel } from '../components/ToolPanel.tsx';
import { useUiLanguage } from '../i18n/UiLanguage.tsx';
import { SITE_URL } from '../siteUrl.ts';
import { sharePreview, type ShareInput } from './seo.ts';
import { useSiteName } from './useSiteName.ts';

interface Props {
  input: Omit<ShareInput, 'siteName' | 'origin'>;
}

/** How the post looks when shared (X, LinkedIn, WhatsApp) and on Google. Presentation only: the logic is in seo.ts. */
export function SharePanel({ input }: Props) {
  const { t } = useUiLanguage();
  const siteName = useSiteName();
  // In production the site and the admin share a domain (SITE_URL = "/"); in development, Astro's.
  const origin = new URL(SITE_URL, window.location.href).origin;
  const preview = useMemo(() => sharePreview({ ...input, siteName, origin }), [input, siteName, origin]);
  const title = preview.title || t('common.untitled');

  return (
    <ToolPanel title={t('tools.share')}>
      <div className="share" lang={input.lang}>
        <p className="label">{t('share.social')}</p>
        <div className={preview.largeCard ? 'share-card share-card-large' : 'share-card'}>
          {preview.image && <img src={preview.image.src} alt={preview.image.alt} />}
          <div className="share-card-text">
            <span className="share-host">{preview.host}</span>
            <strong>{title}</strong>
            <span>{preview.description}</span>
          </div>
        </div>
        {!preview.image && <p className="help">{t('share.noImage')}</p>}
        {input.summary.trim() === '' && <p className="help">{t('share.excerpt')}</p>}

        <p className="label">{t('share.google')}</p>
        <div className="search-result">
          <span className="search-url">{preview.url}</span>
          <span className="search-title">{preview.searchTitle || title}</span>
          <span>{preview.searchDescription}</span>
        </div>
      </div>
    </ToolPanel>
  );
}
