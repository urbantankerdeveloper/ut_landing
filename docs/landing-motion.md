# Landing motion and imagery

## Reveal

Add `Reveal` around below-the-fold content. Use variants `fade-up`, `fade-in`, `slide-left`, `slide-right`, `scale-in`, or `blur-in`. `Reveal` is progressive: content remains visible without JavaScript and is hidden only after `js-reveal` is added by the app.

```tsx
<Reveal variant="fade-up" stagger={120}>...</Reveal>
```

## Flags

- `VITE_LANDING_SCROLL_ANIMATIONS=true`: IntersectionObserver reveals and scroll-linked fallbacks.
- `VITE_LANDING_3D_EFFECTS=true`: desktop card tilt and pointer depth effects.
- `VITE_SERVICE_BACKGROUNDS=true`: enable the refreshed service page, including approved or fallback artwork and motion. Defaults to the original service UI.
- `VITE_HOME_WEBGL_HERO=false`: opt-in lazy three.js home hero.

Set a flag to `false` in `.env.local` to disable it. Existing `.env.local` keys override example values.
Subscription plan cards use a staggered 3D fan reveal on scroll, plus a subtle floating glow on the featured plan. These effects stop under reduced motion and can be disabled with `VITE_LANDING_3D_EFFECTS=false`.

## Image pipeline

1. Copy API keys from Pexels and Pixabay into `.env.local`.
2. Run `npm run images:fetch`.
3. Open `scripts/image-review.html`, visually reject faces, plates, logos, watermarks and mismatches.
4. Set approved `scripts/image-selection.json` entries to the selected original file name.
5. Run `npm run images:optimize`.
6. Run `npm run docs:image-credits`.

The build and UI fall back to the included SVG artwork, then a dark branded gradient when artwork cannot render.
