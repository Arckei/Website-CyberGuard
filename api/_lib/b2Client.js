// Backblaze B2 via its S3-compatible API. We only ever generate short-lived
// PRESIGNED URLs here — the actual application key never reaches the browser.
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let cachedClient = null;

function getEndpoint() {
  const endpoint = String(process.env.B2_ENDPOINT || "").trim();
  if (!endpoint) throw new Error("B2_ENDPOINT is not configured.");
  return /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
}

function getClient() {
  if (!cachedClient) {
    cachedClient = new S3Client({
      endpoint: getEndpoint(),
      region: process.env.B2_REGION || "us-west-004",
      credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APPLICATION_KEY
      }
    });
  }
  return cachedClient;
}

export async function presignPutUrl({ bucket, key, contentType, expiresInSeconds = 300 }) {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}

export async function presignGetUrl({ bucket, key, expiresInSeconds = 300 }) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}

export async function deleteObject({ bucket, key }) {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// Reads just the object's metadata (size, content-type as stored) without
// downloading the file — used to confirm an upload actually landed and
// isn't absurdly larger than what was declared when the URL was issued.
export async function headObject({ bucket, key }) {
  return getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

// Reads only the first `bytes` of an object (a ranged GET) — enough to
// check a magic number without pulling down the whole file. This runs with
// our own server-side credentials, not a presigned URL, so it works even
// on a private bucket.
export async function readObjectHeader({ bucket, key, bytes = 8 }) {
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` })
  );
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}
