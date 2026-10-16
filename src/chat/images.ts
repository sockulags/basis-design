import { IMAGE_TYPES, type PromptImage } from "../../shared/protocol.ts";

export interface Attachment extends PromptImage {
  id: string;
  /** data: URL for the thumbnail. */
  preview: string;
}

/** Longest side sent to the agent; larger images cost tokens without adding detail. */
const MAX_SIDE = 1568;
const MAX_BYTES = 3_500_000;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function toAttachment(dataUrl: string): Attachment {
  const [head = "", data = ""] = dataUrl.split(",", 2);
  const mimeType = head.slice("data:".length, head.indexOf(";"));
  return { id: crypto.randomUUID(), mimeType, data, preview: dataUrl };
}

/** Reads an image file, downscaling or re-encoding it when it is too large or an unsupported type. */
export async function imageAttachment(file: Blob): Promise<Attachment | null> {
  if (!file.type.startsWith("image/")) return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const supported = (IMAGE_TYPES as readonly string[]).includes(file.type);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (supported && scale === 1 && file.size <= MAX_BYTES) {
    bitmap.close();
    return toAttachment(await readAsDataUrl(file));
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  return blob ? toAttachment(await readAsDataUrl(blob)) : null;
}
