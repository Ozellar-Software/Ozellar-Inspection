import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobServiceClient, BlobSASPermissions, StorageSharedKeyCredential, generateBlobSASQueryParameters, type UserDelegationKey,
} from '@azure/storage-blob';

/**
 * Photos live in a PRIVATE container. Phones and browsers get short-lived SAS URLs. How they are signed:
 *  1. PHOTOS_CONNECTION_STRING (account name + key) -> shared-key SAS. Simplest for local dev.
 *  2. else AzureWebJobsStorage, if it contains an AccountKey (optionally PHOTOS_ACCOUNT_KEY / PHOTOS_ACCOUNT override
 *     the key / account name) -> shared-key SAS.
 *  3. else PHOTOS_ACCOUNT + the Function App's managed identity -> user-delegation SAS (no keys anywhere; the Azure setup).
 * A value that is empty or still a "<placeholder>" counts as not set.
 */
const container = process.env.PHOTOS_CONTAINER ?? 'ozellar-attachments';
const isSet = (v?: string) => !!v && v.trim() !== '' && !v.trim().startsWith('<');

const parseConn = (conn: string): Record<string, string> =>
  Object.fromEntries(conn.split(';').filter(Boolean).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));

interface Storage { service: BlobServiceClient; shared?: StorageSharedKeyCredential; account: string }
let storage: Storage | null = null;

function getStorage(): Storage {
  if (storage) return storage;

  const explicit = isSet(process.env.PHOTOS_CONNECTION_STRING) ? process.env.PHOTOS_CONNECTION_STRING! : null;
  const webJobs = isSet(process.env.AzureWebJobsStorage) && /AccountKey=/.test(process.env.AzureWebJobsStorage!) ? process.env.AzureWebJobsStorage! : null;
  const conn = explicit ?? webJobs;

  if (conn) {
    const parts = parseConn(conn);
    const account = (isSet(process.env.PHOTOS_ACCOUNT) ? process.env.PHOTOS_ACCOUNT! : undefined) ?? parts.AccountName;
    const key = (isSet(process.env.PHOTOS_ACCOUNT_KEY) ? process.env.PHOTOS_ACCOUNT_KEY! : undefined) ?? parts.AccountKey;
    if (!account || !key) {
      throw new Error('The storage connection string must contain AccountName and AccountKey (copy it from Storage account > Access keys)');
    }
    // The connection string's own AccountName wins when it is the explicit setting: PHOTOS_ACCOUNT is a managed-identity setting.
    const signAs = explicit && parts.AccountName ? parts.AccountName : account;
    storage = { service: BlobServiceClient.fromConnectionString(conn), shared: new StorageSharedKeyCredential(signAs, key), account: signAs };
  } else if (isSet(process.env.PHOTOS_ACCOUNT)) {
    const account = process.env.PHOTOS_ACCOUNT!;
    storage = { service: new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential()), account };
  } else {
    throw new Error('Photo storage is not configured: set PHOTOS_CONNECTION_STRING (and PHOTOS_CONTAINER) in local.settings.json');
  }
  return storage;
}

let cachedKey: { key: UserDelegationKey; expires: number } | null = null;
async function delegationKey(service: BlobServiceClient): Promise<UserDelegationKey> {
  const now = Date.now();
  if (cachedKey && cachedKey.expires - now > 10 * 60_000) return cachedKey.key;
  const starts = new Date(now - 5 * 60_000);
  const expires = new Date(now + 60 * 60_000);
  const key = await service.getUserDelegationKey(starts, expires);
  cachedKey = { key, expires: expires.getTime() };
  return key;
}

async function sasUrl(blobPath: string, perms: string, minutes: number): Promise<string> {
  const { service, shared, account } = getStorage();
  const opts = {
    containerName: container,
    blobName: blobPath,
    permissions: BlobSASPermissions.parse(perms),
    startsOn: new Date(Date.now() - 5 * 60_000),
    expiresOn: new Date(Date.now() + minutes * 60_000),
  };
  const sas = (shared
    ? generateBlobSASQueryParameters(opts, shared)
    : generateBlobSASQueryParameters(opts, await delegationKey(service), account)).toString();
  return `${service.getContainerClient(container).getBlockBlobClient(blobPath).url}?${sas}`;
}

/** Create/write only, 15 minutes — the phone PUTs the JPEG with header x-ms-blob-type: BlockBlob. */
export const uploadUrl = (blobPath: string) => sasUrl(blobPath, 'cw', 15);
/** Read only, 60 minutes. */
export const readUrl = (blobPath: string) => sasUrl(blobPath, 'r', 60);

export async function blobExists(blobPath: string): Promise<boolean> {
  try {
    return await getStorage().service.getContainerClient(container).getBlockBlobClient(blobPath).exists();
  } catch (err) {
    console.error('blobExists check failed', err);
    return false;
  }
}

export function photoBlobPath(p: { id: string; inspectionId?: string | null; vesselId?: string | null }): string {
  return p.inspectionId ? `inspections/${p.inspectionId}/${p.id}.jpg` : `vessels/${p.vesselId}/${p.id}.jpg`;
}
