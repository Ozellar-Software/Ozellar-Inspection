import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, type UserDelegationKey,
} from '@azure/storage-blob';

/**
 * Photos live in a PRIVATE container. Phones get short-lived user-delegation SAS URLs
 * (signed with the Function App's managed identity — no account keys anywhere).
 */
const account = process.env.PHOTOS_ACCOUNT ?? '';
const container = process.env.PHOTOS_CONTAINER ?? 'photos';
const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());

let cachedKey: { key: UserDelegationKey; expires: number } | null = null;
async function delegationKey(): Promise<UserDelegationKey> {
  const now = Date.now();
  if (cachedKey && cachedKey.expires - now > 10 * 60_000) return cachedKey.key;
  const starts = new Date(now - 5 * 60_000);
  const expires = new Date(now + 60 * 60_000);
  const key = await service.getUserDelegationKey(starts, expires);
  cachedKey = { key, expires: expires.getTime() };
  return key;
}

async function sasUrl(blobPath: string, perms: string, minutes: number): Promise<string> {
  const key = await delegationKey();
  const sas = generateBlobSASQueryParameters({
    containerName: container,
    blobName: blobPath,
    permissions: BlobSASPermissions.parse(perms),
    startsOn: new Date(Date.now() - 5 * 60_000),
    expiresOn: new Date(Date.now() + minutes * 60_000),
    protocol: undefined,
  }, key, account).toString();
  return `https://${account}.blob.core.windows.net/${container}/${blobPath}?${sas}`;
}

/** Create/write only, 15 minutes — the phone PUTs the JPEG with header x-ms-blob-type: BlockBlob. */
export const uploadUrl = (blobPath: string) => sasUrl(blobPath, 'cw', 15);
/** Read only, 60 minutes. */
export const readUrl = (blobPath: string) => sasUrl(blobPath, 'r', 60);

export async function blobExists(blobPath: string): Promise<boolean> {
  return service.getContainerClient(container).getBlockBlobClient(blobPath).exists();
}

export function photoBlobPath(p: { id: string; inspectionId?: string | null; vesselId?: string | null }): string {
  return p.inspectionId ? `inspections/${p.inspectionId}/${p.id}.jpg` : `vessels/${p.vesselId}/${p.id}.jpg`;
}
