/*
 * The API's validation limits, in one place of the admin. The admin uses them to warn before sending (validation,
 * `maxLength`, counters, guides); the API stays the authority. test/limits.test.ts reads the domain constants in C#
 * (Blog.Domain) and compares them with these: if one side changes and not the other, the test fails. Only what the
 * admin uses is here (YAGNI): adding a limit = adding it here and in that test.
 */
export const LIMITS = {
  /** PostContent and Slug. */
  post: { title: 200, slug: 120, summary: 400, coverAlt: 300 },
  /** SiteSettingsContent. The English variants have the same limits as their Spanish counterparts. */
  settings: { name: 100, tagline: 200, bio: 2000, email: 254 },
  /** WebUrl: every URL (links, cover). */
  url: 2048,
  /** HeroImageContent: alt and credit, in both languages. */
  heroImage: { alt: 300, credit: 200 },
  /** HeroFrame: one single rule for photos and videos. */
  heroFrame: {
    ideal: { width: 1920, height: 1080 },
    min: { width: 1280, height: 720 },
    // Width ≥ 6/5 of the height. As an integer fraction, like the API: comparing 1.2 × height in floating point could
    // reject (or accept) through rounding a size that the API treats differently.
    minAspect: { numerator: 6, denominator: 5 },
  },
  /** VideoEdit: how long the segment can last and the fades that can be chosen. */
  video: { minSeconds: 1, maxSeconds: 15, fadeSeconds: [0.5, 1, 2], defaultFadeSeconds: 1 },
} as const;
