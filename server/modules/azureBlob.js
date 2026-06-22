const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
} = require("@azure/storage-blob");
const { nanoid } = require("nanoid");

const logger = require("./logger").child({ module: "azureBlob" });

// How long a generated read-only SAS link to a screenshot stays valid.
const SAS_EXPIRY_DAYS = 30;

// The account name is the first label of the storage endpoint host, e.g.
// https://aos1.blob.core.usgovcloudapi.net -> "aos1".
const accountNameFromEndpoint = (endpoint) => {
  try {
    return new URL(endpoint).hostname.split(".")[0];
  } catch (err) {
    return null;
  }
};

// Lazily built so requiring this module (e.g. in tests, or when blob storage is
// not configured) never throws or reaches out to Azure on load.
let cachedCredential = null;
let cachedClient = null;

const getCredential = () => {
  if (cachedCredential) return cachedCredential;

  const endpoint = process.env.AZURE_STORAGE_ENDPOINT;
  const key = process.env.AZURE_STORAGE_KEY;
  const accountName = accountNameFromEndpoint(endpoint);

  if (!endpoint || !key || !accountName) {
    throw new Error(
      "Azure Blob Storage is not configured (need AZURE_STORAGE_ENDPOINT and AZURE_STORAGE_KEY)",
    );
  }

  cachedCredential = new StorageSharedKeyCredential(accountName, key);
  return cachedCredential;
};

const getClient = () => {
  if (cachedClient) return cachedClient;
  const endpoint = process.env.AZURE_STORAGE_ENDPOINT;
  cachedClient = new BlobServiceClient(endpoint, getCredential());
  return cachedClient;
};

const isConfigured = () => Boolean(
  process.env.AZURE_STORAGE_ENDPOINT && process.env.AZURE_STORAGE_KEY,
);

// Maps common image content types to a sensible file extension for the blob name.
const extensionForContentType = (contentType) => {
  switch (contentType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/jpg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "bin";
  }
};

/**
 * Upload a buffer to a container and return a time-limited read-only URL.
 *
 * The container is treated as private; the returned link carries a SAS token so
 * it can be opened without account credentials until it expires.
 *
 * @param {object} params
 * @param {Buffer} params.buffer        File bytes.
 * @param {string} params.container     Target container name.
 * @param {string} [params.contentType] MIME type stored on the blob.
 * @param {string} [params.prefix]      Optional path prefix inside the container.
 * @returns {Promise<string>} A read-only SAS URL to the uploaded blob.
 */
const uploadBuffer = async ({
  buffer, container, contentType, prefix = "",
}) => {
  if (!container) throw new Error("uploadBuffer requires a container name");

  const containerClient = getClient().getContainerClient(container);

  const ext = extensionForContentType(contentType);
  const blobName = `${prefix}${nanoid(16)}.${ext}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: contentType ? { blobContentType: contentType } : undefined,
  });

  const startsOn = new Date(Date.now() - 5 * 60 * 1000); // tolerate clock skew
  const expiresOn = new Date(Date.now() + SAS_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName: container,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn,
    },
    getCredential(),
  ).toString();

  return `${blockBlobClient.url}?${sas}`;
};

/**
 * Upload one or more feedback screenshots to the feedback container.
 *
 * @param {Array<{buffer: Buffer, mimetype: string}>} files multer in-memory files.
 * @returns {Promise<string[]>} Read-only SAS URLs, one per uploaded file.
 */
const uploadFeedbackScreenshots = async (files = []) => {
  const container = process.env.AZURE_STORAGE_CONTAINER_FEEDBACK_NAME || "feedback";

  const urls = await Promise.all(
    files.map((file) => uploadBuffer({
      buffer: file.buffer,
      container,
      contentType: file.mimetype,
    })),
  );

  logger.info({ count: urls.length, container }, "uploaded feedback screenshots");
  return urls;
};

module.exports = {
  isConfigured,
  uploadBuffer,
  uploadFeedbackScreenshots,
};
