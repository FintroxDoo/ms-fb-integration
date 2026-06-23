-- CreateTable
CREATE TABLE "OAuthToken" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerSync" (
    "id" SERIAL NOT NULL,
    "fbClientId" TEXT NOT NULL,
    "upflowCustomerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSync" (
    "id" SERIAL NOT NULL,
    "fbInvoiceId" TEXT NOT NULL,
    "upflowInvoiceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookCallback" (
    "id" SERIAL NOT NULL,
    "callbackId" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "verifier" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookCallback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthToken_provider_key" ON "OAuthToken"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSync_fbClientId_key" ON "CustomerSync"("fbClientId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSync_fbInvoiceId_key" ON "InvoiceSync"("fbInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCursor_key_key" ON "SyncCursor"("key");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookCallback_callbackId_key" ON "WebhookCallback"("callbackId");
