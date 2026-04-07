# Storefront UX

## Goal

The storefront should make a discount obvious without making the store feel cheap, noisy, or fragile.

## MVP Direction

- Product page: app block with a clear badge and savings line placed next to the theme's native price area.
- Product cards: app embed that adds a badge on the product image and a small savings row near the price.
- Simple text options:
  - `Spar 30%`
  - `Salg 30%`
  - `-30%`
  - custom template with `{{ percent }}` or `{{ amount }}`

## Safe Integration Principles

- The theme price is the source of truth.
- Better Discounts should enhance the price presentation by default, not replace it.
- Any extra custom price row should be treated as an advanced option and remain off by default.
- This reduces the risk of conflicts with variant switching, currency handling, subscription pricing, and theme-specific sale logic.

## Why This Direction

- The product page gets a strong sales message close to the buy area without taking over critical pricing logic.
- Product cards improve discoverability in collections and on the home page.
- Merchants do not need to edit theme code manually.

## Future Improvements

- Connect app data directly to the extension instead of relying only on compare-at pricing.
- Add a deep link to the theme editor for faster onboarding.
- Ship curated style presets such as `Diskret`, `Tydelig`, and `Kampanje`.
- Add carefully tested advanced theme overrides only where compatibility is known.
