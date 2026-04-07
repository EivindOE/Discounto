# Shopify-arkitektur

## Anbefalt løsning

### 1. Embedded app

Merchants oppretter og administrerer rabatter i embedded admin-appen.

### 2. Shopify Billing

Abonnement håndteres med Shopify sin app-billing, der aktiv plan setter produktgrense i appen.

### 3. Theme app extension

Frontend-visning bør bygges som en theme app extension, slik at kunden slipper manuell kodeendring i theme-filer. Appen kan bruke deep links til theme editor for å gjøre aktivering enklere.

### 4. Rabattmotor

Det finnes to forskjellige behov:

- selve rabatten som påvirker pris/checkout
- frontend-visningen som forteller kunden at produktet er på rabatt

Derfor bør appen ha:

- en lagret kampanje i egen database
- en Shopify-rabatt opprettet via Admin GraphQL eller Functions
- frontend-data som theme extension kan lese og vise

## Offisielle Shopify-spor å bygge videre på

- Theme app extensions for blokk/embed i storefront
- App subscriptions for fakturering
- Admin GraphQL for rabattopprettelse og synk

## Praktisk MVP-flyt

1. Merchant installerer appen.
2. Merchant oppretter rabattkampanje og velger produkter.
3. Appen verifiserer planlimit.
4. Appen oppretter/synker rabatt i Shopify.
5. Theme app extension viser badge/tekst på produktene.
6. Merchant kan oppgradere plan hvis grensen nås.
