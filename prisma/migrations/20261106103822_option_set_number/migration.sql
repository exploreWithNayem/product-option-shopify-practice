-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OptionSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "number" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "fields" TEXT NOT NULL DEFAULT '[]',
    "rules" TEXT NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_OptionSet" ("createdAt", "fields", "id", "name", "priority", "productCount", "publishedAt", "rules", "shop", "status", "updatedAt", "version") SELECT "createdAt", "fields", "id", "name", "priority", "productCount", "publishedAt", "rules", "shop", "status", "updatedAt", "version" FROM "OptionSet";
DROP TABLE "OptionSet";
ALTER TABLE "new_OptionSet" RENAME TO "OptionSet";
CREATE INDEX "OptionSet_shop_status_idx" ON "OptionSet"("shop", "status");
CREATE INDEX "OptionSet_shop_number_idx" ON "OptionSet"("shop", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Give existing option sets a 6-digit display ID.
UPDATE "OptionSet" SET "number" = (abs(random()) % 900000) + 100000 WHERE "number" = 0;
