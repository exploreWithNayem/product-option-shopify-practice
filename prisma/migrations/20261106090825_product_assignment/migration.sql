-- CreateTable
CREATE TABLE "ProductAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "optionSetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ProductAssignment_shop_optionSetId_idx" ON "ProductAssignment"("shop", "optionSetId");
