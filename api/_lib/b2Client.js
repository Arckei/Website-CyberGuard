// Backblaze B2 via its S3-compatible API. We only ever generate short-lived
// PRESIGNED URLs here — the actual application key never reaches the browser.
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    cachedClient = new S3Client({
      endpoint: process.env.B2_ENDPOINT,
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
