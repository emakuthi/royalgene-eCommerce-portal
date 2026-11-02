# RoyalTrack mobile sync rules

The rules a RoyalTrack mobile app must follow to work offline and sync with the server. Android is the reference, and the iOS app must get the same results.

- **Based on:** Android `f321091` and portal `08b5992`, read on 2026-11-03.
- **How it was checked:** by reading the code. Nothing here was run or reproduced on a device.
- **Android code:** `data/sync/`, `data/auth/okhttp/`, `data/repository/LocalFirst*`
- **Server code:** `src/lib/sync/`, `src/app/api/mobile/`, `src/middleware.ts`

Sections 1 to 8 describe how sync works once the fixes on branches `fix/sale-sold-at` (portal), `fix/sync-wait-states`, `fix/per-user-local-db` and `fix/offline-sale-time` (Android) are merged. Section 9 lists the Android problems iOS should not copy, and section 10 lists the open decisions.

## 1. Core rules

1. **A recorded sale is never lost silently.** It stays on the phone until the server accepts it or the user removes it.
2. **Waiting is not failing.** Being signed out, or being in a read-only workspace, never uses up retries and never reverses a sale.
3. **Only a clear refusal, or running out of retries, marks a write as failed.** The user sees the reason and can retry or remove it.
4. **The server is the authority on stock.** Local stock changes are a temporary estimate until the next pull replaces them.
5. **Retrying is always safe.** The phone generates each record's id, and the server ignores an id it already has.

## 2. What works offline

| Action | How it runs | Notes |
|---|---|---|
| Record a sale | **Offline queue** | One queue row per line in the checkout |
| Transfer stock, plain quantity | **Offline queue** | Falls back to online if the source shop has no local stock row |
| Transfer stock, size/colour | Online only | The server has to move stock cell by cell |
| Edit or delete a sale | Online only | |
| Create or edit a product | Online only | `InventoryEditViewModel` calls the API directly |
| Approve, reject or cancel a transfer | Online only | |
| Expenses | Online only | Not in the sync feed |

Android also has queue code for product, shop and alert writes, but I found no screen that uses it. iOS doesn't need it for the first version.

## 3. Local storage

**Tables synced from the server:** `Product`, `Shop`, `ShopStock`, `ShopStockVariant`, `SalesEntry`, `StockTransaction`, `Alert`.

**Each synced row has:** `updatedAt`, `deletedAt`, `version`, `syncStatus`. `StockTransaction` is append-only and never deleted.

**`syncStatus` values:** `SYNCED`, `PENDING_CREATE`, `PENDING_UPDATE`, `PENDING_DELETE`, `SYNCING`, `FAILED`.

**Queue row (`sync_queue`):** `organizationId`, `entityType`, `entityId`, `operation`, `payload` (JSON), `idempotencyKey`, `status`, `retryCount`, `lastAttemptAt`, `error`, `createdAt`.

**Queue `status` values:**

| Status | Meaning | Picked up by the next push? |
|---|---|---|
| `PENDING` | Not sent yet | Yes |
| `FAILED` | Failed, will retry | Yes |
| `SYNCED` | Server accepted it | No |
| `REJECTED` | Finished without success | No, unless the user retries |

**One database per user:** the file is `royaltrack-<organizationId>-<userId>.db` and is kept after sign-out, so a user's unsent sales send when that user signs back in. On upgrade, the first user to open the workspace takes over the old `royaltrack-<organizationId>.db`.

**Sync state:** one row with the key `*` holds the pull cursor. Treat the cursor as opaque.

## 4. Recording a write

**A sale:**

1. Generate a UUID for each line, and one `saleGroupId` for the checkout.
2. Save the line as `PENDING_CREATE`.
3. Reduce local stock (see below).
4. Add a queue row, using the sale id as the idempotency key.
5. Trigger a sync.

**Local stock change for a sale:**

- Reduce `ShopStock.quantity` and `Product.stockQuantity`.
- If the line has a size or colour, also reduce the matching `ShopStockVariant`.
- Skip all of this for products with `kind == "menu"`. The server uses up their ingredients, and the next pull brings the new counts.
- Leave these rows as `SYNCED` so the next pull can overwrite them.

**A plain-quantity transfer:**

- Reduce `ShopStock.quantity` at the source shop only.
- Don't change `Product.stockQuantity` or the receiving shop. Stock arrives there on a pull after the transfer is approved.

**Double-tap protection:** if a queue row already has the same idempotency key, don't add another.

## 5. Push

Each sync pushes first, then pulls. Push takes up to 25 `PENDING` or `FAILED` rows, oldest first.

| Queue row | Request |
|---|---|
| Sale | `POST shops/{shopId}/sales` |
| Transfer | `POST shops/{shopId}/stock/transfer` |

**Sale request fields:** `id`, `productId`, `quantity`, `unitPrice`, `paymentMethod`, `customerName`, `customerPhone`, `notes`, `size`, `color`, `saleGroupId`, `currency`, `paymentBreakdown`, `discountAmount`, `soldAt`.

`soldAt` is when the sale really happened, as ISO-8601 UTC. The server uses it as the sale's `createdAt`, unless it's missing, unreadable, in the future or more than 90 days old. Then it uses the arrival time.

**Transfer request fields:** `id`, `productId`, `toShopId`, `quantity`, `notes`.

**Handling the response:**

| Response | Result | Uses a retry? | Reverses stock? | Then |
|---|---|---|---|---|
| 2xx with `success: true` (including `idempotent: true`) | Row and sale become `SYNCED` | No | No | Next row |
| 2xx with `success: false` | `REJECTED` | n/a | Yes | Next row |
| 401, still failing after a token refresh | Waits | No | No | **Stop the push** |
| 402 with code `READ_ONLY` or `TRIAL_EXPIRED` | Waits | No | No | **Stop the push** |
| 403 with code `ORG_SUSPENDED` | Waits | No | No | **Stop the push** |
| No response (offline, timeout, DNS, TLS) | Waits | No | No | **Stop the push** |
| 400, 403 (including `ORG_CLOSED`), 409 or 422 | `REJECTED` | n/a | Yes | Next row |
| Any other HTTP status, including 5xx, 404, 429 and other 402s, or an unexpected error | `FAILED` | Yes | No | Next row |
| 10th failed attempt | `REJECTED` | n/a | Yes | Next row |

Save the server's `error` or `message` text on the queue row, because it's what the user sees. The exception is a `VERSION_CONFLICT` 409 on a product update, which isn't a rejection. Only the unused product queue path can hit that.

**Common refusals:**

| Code | Status | When |
|---|---|---|
| `INSUFFICIENT_STOCK` | 409 | Not enough stock at the server |
| `COST_PRICE_REQUIRED` | 409 | The product has no cost price |
| `VALIDATION_ERROR` | 400 | Missing or invalid fields |
| `FORBIDDEN` | 403 | The user lacks permission |

### After a rejection

- **Sale:** reverse the local stock change and set the sale to `FAILED`. It stays visible only on that phone.
- **Transfer:** return the quantity to the source shop and tell the user it was reversed. There's no sale row, so read this from `REJECTED` queue rows.

### Retry and remove (failed sales)

- **Status of a checkout:** `FAILED` if any line failed, otherwise pending if any line is unsent, otherwise synced.
- **Retry:** in one transaction, for each failed line, set the queue row back to `PENDING` with `retryCount = 0`, reapply the stock change and set the sale to `PENDING_CREATE`.
- **Remove:** delete the failed lines from the phone. Their stock was already returned, so don't return it again.
- **Partial checkouts are possible:** each line is sent separately, so one line can fail while others succeed. Show that clearly, and only retry the failed lines.
- **Plain-language reasons (`FailedSales.explain`):**
  - Stock errors show the server's message.
  - 5xx errors say it was a server error and to try again.
  - Errors with no HTTP status say to check the connection.

## 6. Pull

`GET sync/changes?since=<cursor>&limit=200`. Leave out `since` on the first sync. The server caps `limit` at 500.

```json
{
  "success": true,
  "data": {
    "cursor": "opaque",
    "hasMore": true,
    "changes": [
      {
        "entity": "Product",
        "id": "uuid",
        "operation": "UPSERT",
        "version": 3,
        "updatedAt": "2026-10-10T17:35:50.44+00:00",
        "data": {}
      }
    ]
  }
}
```

**Paging:** apply a page, save the new cursor, and repeat while `hasMore` is true. Reapplying a page after a crash is harmless.

**Applying each change:**

1. If the local row isn't `SYNCED`, skip the change. Unsent local work wins.
2. If `operation` is `DELETE`, `data` will be null. Set `deletedAt` on the local row and mark it `SYNCED`. If there's no local row, ignore the change.
3. Otherwise, replace the local row and mark it `SYNCED`.
4. Ignore unknown entity types. A newer server may send types this build doesn't know.

**What the server filters:**

- Results are limited to the organization in the token. The app never sends an organization id.
- Staff assigned to specific shops only receive those shops' sales. Admins, managers and owners receive every shop's.
- Cost fields are null for users who can't view cost data. Use `hasCostPrice` to tell whether a cost price exists.
- If one entity's query fails, the server still returns `success: true`, and that entity catches up on a later pull.

**Reading the fields:**

| Field | Rule |
|---|---|
| Money | Accept a number or a string, and store it as an exact decimal. Values are **major units** (KES, not cents) |
| Unknown cost price | Keep it null. Never turn it into 0 |
| Quantities | Up to 3 decimal places, as a number or a string |
| `unit` | Defaults to `piece` |
| `kind` | `menu`, otherwise `stock` |
| `saleGroupId` | Falls back to the sale's own id |
| `paymentBreakdown` | Keep only when it has more than one part |
| `discountAmount` | Keep only when above 0 |
| Sale date | `entryDate`, falling back to `createdAt` |

**Timestamps:** values can end in `+00:00`, `Z` or no zone at all, with 0 to 6 fraction digits, and may use a space instead of `T`. **Treat no zone as UTC.** Reading it as local time is what made times 3 hours early in Kenya.

`Product.stockQuantity` from the feed is the total across all shops. Each shop's own quantity comes from `ShopStock`.

## 7. Sign-in and tokens

**Server address:** each workspace has its own `.../api/mobile/` address, which is kept after sign-out. A new sign-up starts on the default address and switches to its subdomain once its certificate is ready (`WorkspacePromoter`). Read-only and suspension checks use the address the app calls.

**Sign-in request:** send `deviceId`, `deviceName`, `platform` and `appVersion`.

- iOS must send `platform: "ios"`, because the server assumes `android` when it's missing.
- `deviceId` must stay the same for each install. Without it, the token gets no grace period and can't be signed out remotely.

**Tokens:** they last 7 days. A token with a `deviceId` is still accepted for 30 days after it expires, so the app can renew it.

**Renewal:**

- Before each sync, renew with `POST auth/refresh` if the token expires within 2 days.
- On a 401, refresh once and resend the request. Only allow one refresh at a time.
- If another request has already refreshed, resend with the new token.

| Refresh result | What to do |
|---|---|
| New token | Save it and continue |
| 401, or code `DEVICE_REVOKED` | End the session and go to sign-in. **Keep the queue**, which sends after sign-in |
| Offline or another error | Keep the session and try later |

## 8. When sync runs

| Trigger | Android | iOS |
|---|---|---|
| App opens | Home screen starts a sync | Same, and also when returning from the background |
| After a local write | Immediately | Same |
| Pull to refresh | Yes | Same |
| Connection returns | The queued work runs when the network is back | Use `NWPathMonitor` |
| In the background | Every 15 minutes, with backoff | `BGTaskScheduler`, which iOS may delay or skip |
| Sign-out | Cancels scheduled sync | Same |

Because iOS background runs aren't guaranteed, the app must always show unsent sales clearly. Never tell the user a sale has reached the server until it has.

**iOS details to get right:**

- **Lowercase UUIDs.** Swift's `uuidString` is uppercase, and Android and the server use lowercase. Convert with `.lowercased()`.
- **Valid UUIDs only.** The server silently creates its own id if yours is invalid, which removes retry protection and can create duplicate sales.
- **Numbers as JSON numbers.** `quantity` and `unitPrice` must be numbers, or the server returns 400. Round before encoding so `Decimal` doesn't send long fractions.
- **Empty values.** Send blank `size` and `color` as null, and only send `paymentBreakdown` when it has more than one part.
- **Secure storage.** Keep the token and `deviceId` in the Keychain.

## 9. Android problems iOS should not copy

Found by reading the code. Severity is my own estimate. iOS changes here are proposals until approved. Numbers 1 to 4 (sale date, network failures counting as retries, shared database, suspended workspaces) were fixed on the branches named at the top, so they aren't listed.

| # | Severity | Android today | Effect | Proposed for iOS |
|---|---|---|---|---|
| 5 | Medium | The periodic and immediate syncs are separate jobs | They can overlap and send the same row twice. The server's id check prevents duplicates, but a retry can be wasted | Allow only one sync at a time |
| 6 | Medium | Reversals add back the full quantity, even if a pull has already replaced the stock, and stock is floored at 0 | Local stock can end up too high until that row next changes on the server | Store the server's quantity, and show it minus unsent writes |
| 7 | Low | The queue is never cleaned up (`purgeSynced` has no callers) | It grows forever | Delete `SYNCED` rows after 30 days |
| 8 | Low | Each run sends 25 rows and stops | A large backlog clears slowly, and 25 stuck rows can hold up newer ones | Loop until empty, with backoff on failing rows |
| 9 | Low | Staff who gain a shop or role don't receive older data, because the cursor has passed it | Their local data stays incomplete | Reset the cursor and pull again when the role changes. Shop changes need a server signal |

**Also avoid on iOS:**

- Unsent product deletes (`PENDING_DELETE`) are never sent, and they block pulls for that row. This code currently has no callers.
- A later version that starts handling a new entity type must reset the cursor, because older builds have already skipped past those rows. Sending an explicit `entities` list avoids this.

## 10. Open decisions

1. **Force update:** `PlatformSettings.minAppVersionCode` is a single value. iOS needs its own, because its version numbers will differ.
2. **Plan-limit 402s:** other 402s use up all 10 retries even though retrying won't help. Should they be refusals instead?

## 11. Shared test cases

Both apps should pass these. "Android" marks cases I saw in Android's test suite. I read those tests but didn't run them.

**Push**

| # | Scenario | Expected | Android |
|---|---|---|---|
| 1 | Sale accepted | Row and sale `SYNCED`, stock stays reduced until the pull | |
| 2 | Same sale id sent twice | One sale on the server, stock reduced once | |
| 3 | Sale refused with 422 | Stock restored, sale `FAILED`, not retried | Yes |
| 4 | Sale refused with `INSUFFICIENT_STOCK` | Same as 3, and the user sees the server's message | |
| 5 | 401, repeated 15 times | Still queued, `retryCount` 0, stock still reduced | Yes |
| 6 | 402 `READ_ONLY`, repeated 15 times | Still queued, `retryCount` 0, stock still reduced | Yes |
| 7 | 401 on the first row of several | Push stops, other rows untouched | |
| 8 | 500, 10 times | `REJECTED` on the 10th, stock restored | |
| 9 | Offline, repeated 15 times | Still queued, `retryCount` 0, stock still reduced | Yes |
| 9a | 403 `ORG_SUSPENDED`, repeated 15 times | Still queued, `retryCount` 0, stock still reduced | Yes |
| 9b | 403 `ORG_CLOSED` | Same as 3 | Yes |
| 9c | Sale made offline yesterday | Sent with yesterday's time as `soldAt` | Yes |
| 10 | Transfer refused | Quantity returned to the source, receiving shop unchanged | Yes |

**Retry and checkout**

| # | Scenario | Expected | Android |
|---|---|---|---|
| 11 | Retry a failed sale | Back in the queue, stock reduced again, `retryCount` 0 | |
| 12 | Remove a failed sale | Gone from the phone, stock not added back a second time | |
| 13 | Checkout where one of two lines fails | Shows as failed, retry only sends the failed line | |
| 14 | Menu item sold, then refused | No local stock change either way | |
| 15 | Size/colour sale, then refused | Variant, shop and product totals all restored | |

**Pull**

| # | Scenario | Expected | Android |
|---|---|---|---|
| 16 | Change arrives for a row with unsent work | Skipped, local work kept | |
| 17 | Delete arrives for a known row | Row hidden, marked `SYNCED` | |
| 18 | Delete arrives for an unknown row | Ignored, no crash | |
| 19 | Unknown entity type | Ignored, pull continues | |
| 20 | Stopped between pages | Resumes from the saved cursor, no duplicates | |
| 21 | Timestamp with no zone | Read as UTC | |
| 22 | Cost price is null | Stored as unknown, not 0 | |

**Sign-in**

| # | Scenario | Expected | Android |
|---|---|---|---|
| 23 | Token expires within 2 days | Renewed before the sync | |
| 24 | Token past the 30-day grace period | Sent to sign-in, queue kept and sent after signing in | |
| 25 | Device signed out remotely | Sent to sign-in, queue kept | |
| 26 | Several requests get a 401 together | Only one refresh | |
| 27 | User B signs in after user A | B can't see A's data, and A's queue isn't sent under B | Partly (separate files) |

## 12. Keeping this document current

Update it in the same pull request when you change any of these:

- anything in `data/sync/` on Android
- the push routes or `src/lib/sync/` on the server
- token handling, or the read-only and suspension checks
