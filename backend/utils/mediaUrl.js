export function buildPublicMediaUrl(filename) {
  const baseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    const error = new Error("PUBLIC_BASE_URL is required for Instagram publishing. Configure an ngrok or production URL first.");
    error.status = 500;
    throw error;
  }
  const encodedPath = filename.split(/[\\/]/).map(encodeURIComponent).join("/");
  return `${baseUrl}/uploads/${encodedPath}`;
}
