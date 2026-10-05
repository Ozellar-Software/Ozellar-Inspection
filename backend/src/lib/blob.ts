import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential, type UserDelegationKey,
} from '@azure/storage-blob';

/**
 * Photos live in a PRIVATE container. Phones and browsers get short-lived SAS URLs.
 * When AzureWebJobsStorage has AccountKey, signs directly via StorageSharedKeyCredential.
 * In Azure with Managed Identity, signs via user-delegation key.
 */
const account = process.env.PHOTOS_ACCOUNT ?? '';
const container = process.env.PHOTOS_CONTAINER ?? 'ozellar-attachments';
const connStr = process.env.AzureWebJobsStorage ?? '';

const keyMatch = connStr.match(/AccountKey=([^;]+)/);
const accountKey = process.env.PHOTOS_ACCOUNT_KEY ?? (keyMatch ? keyMatch[1] : null);
const sharedKeyCred = account && accountKey ? new StorageSharedKeyCredential(account, accountKey) : null;

const service = connStr
  ? BlobServiceClient.fromConnectionString(connStr)
  : new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());

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
  const startsOn = new Date(Date.now() - 5 * 60_000);
  const expiresOn = new Date(Date.now() + minutes * 60_000);

  if (sharedKeyCred) {
    const sas = generateBlobSASQueryParameters({
      containerName: container,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse(perms),
      startsOn,
      expiresOn,
    }, sharedKeyCred).toString();
    return `https://${account}.blob.core.windows.net/${container}/${blobPath}?${sas}`;
  }

  const key = await delegationKey();
  const sas = generateBlobSASQueryParameters({
    containerName: container,
    blobName: blobPath,
    permissions: BlobSASPermissions.parse(perms),
    startsOn,
    expiresOn,
  }, key, account).toString();
  return `https://${account}.blob.core.windows.net/${container}/${blobPath}?${sas}`;
}

/** Create/write only, 15 minutes — the phone PUTs the JPEG with header x-ms-blob-type: BlockBlob. */
export const uploadUrl = (blobPath: string) => sasUrl(blobPath, 'cw', 15);
/** Read only, 60 minutes. */
export const readUrl = (blobPath: string) => sasUrl(blobPath, 'r', 60);

export async function blobExists(blobPath: string): Promise<boolean> {
  try {
    return await service.getContainerClient(container).getBlockBlobClient(blobPath).exists();
  } catch (err) {
    console.error('blobExists check failed', err);
    return false;
  }
}

export function photoBlobPath(p: { id: string; inspectionId?: string | null; vesselId?: string | null }): string {
  return p.inspectionId ? `inspections/${p.inspectionId}/${p.id}.jpg` : `vessels/${p.vesselId}/${p.id}.jpg`;
}
