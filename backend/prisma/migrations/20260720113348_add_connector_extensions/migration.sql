-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConnectorAuthMethod" ADD VALUE 'OIDC';
ALTER TYPE "ConnectorAuthMethod" ADD VALUE 'MTLS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConnectorType" ADD VALUE 'SOAP_API';
ALTER TYPE "ConnectorType" ADD VALUE 'GRPC_API';
ALTER TYPE "ConnectorType" ADD VALUE 'XML_API';

-- AlterTable
ALTER TABLE "connectors" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

