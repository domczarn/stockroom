# Bulk orders and workspace layout

Orders records wholesale and other sourcing batches in each user's existing versioned cloud workspace. Suppliers and references are private to that workspace. No new credentials, external integrations or automated purchasing are introduced.

Record supplier, channel, reference/link, purchase/expected/received dates, delivery status, goods/delivery/other costs and item groups. A received batch can create stock once. Equal cost allocation uses integer pennies with the remainder distributed over the first pieces, so the stock cost totals match the batch total exactly. Receipt inspection and splitting into actual named pieces is a manual step. Photos, condition and unverified brand remain blank.

Batch creation and its stockCreatedAt marker save atomically through the existing revision checked workspace PUT. Once stock exists, batch cost, contents and purchase date are locked in the editor. Individual stock edits continue through existing controls. Orders do not write an expense or sale; inventory cost feeds existing profit calculations on sale. Cancelled orders remain as records and are excluded from order metrics. Removing a linked stock item does not permit reimporting the batch.

Stock card source links and stock editor source panels open the corresponding order. Stock search includes the current supplier/reference. Account backups include bulkOrders with the rest of the workspace.

Shared layout styles improve cards, contrast, focus rings, touch targets, header/menu layout, desktop grid and phone sheets. Phone navigation is Home, Stock, Orders, Profile; the header menu provides the remaining screens including Expenses and Transactions. Existing photo-grid, detailed-list and compact-list preferences are retained.

Validation: build; orders allocation, replay, source provenance and schema tests; combined global script parse; existing account isolation/security, Resources, customer care and expense tests. Browser preview: create received 3-piece £110.01 order, save, add stock, confirm 3 linked items and no repeated Add to stock button. Reviewed 390px phone shell, stock cards/editor and desktop orders page. Device-specific iOS/Android hardware testing was not performed. Preview samples are not seeded into production.
