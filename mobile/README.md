# Stockroom app (App Store and Google Play)

This wraps the live site (stockroom.bookednpaid.com) in a native app using Capacitor. App updates ship the same way the site does: push to `main`, and the app shows the new version next time it opens. A store re-submission is only needed when this folder changes.

What's already handled in the web app when it runs inside the native app:
- Gmail connect opens in the phone's browser (Google blocks sign-in inside apps), and the app picks the connection up when you come back.
- Plans aren't sold inside the app (Apple and Google require their own payments for that). Free limits still show; upgrading happens on the website.

## Android (Google Play)

1. Install Android Studio.
2. In this folder:
   - `npm install`
   - `npx cap sync android`
   - `npx cap open android`
3. In Android Studio: Build → Generate Signed App Bundle → create a new upload key and keep it safe.
4. Play Console (one-off $25 fee) → Create app → upload the `.aab` → fill in the store listing, privacy policy (https://stockroom.bookednpaid.com/privacy.html) and data safety form.

## iPhone (App Store)

Needs a Mac (or a cloud Mac build service such as Codemagic) and an Apple Developer account (£79 a year).

1. On the Mac, in this folder:
   - `npm install`
   - `npx cap add ios`
   - `npx cap open ios`
2. In Xcode: Signing & Capabilities → pick your team → set the bundle ID to `com.bookednpaid.stockroom`.
3. Product → Archive → Distribute App → App Store Connect.
4. App Store Connect → new app → screenshots, privacy policy, App Privacy answers → submit for review.

## Before submitting

- Apple sometimes rejects apps that are "just a website". Stockroom's camera features (Buy or pass, photos, label scanning) help. Adding native push notifications (`@capacitor/push-notifications`) before submitting makes approval more likely. The server currently sends web push, so native push needs its own sending path.
- Icons and splash screens: `npx @capacitor/assets generate` from a 1024×1024 icon.
