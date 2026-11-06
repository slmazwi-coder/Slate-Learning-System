import { inflateRawSync } from "node:zlib";

// A .docx is a ZIP holding word/document.xml. The deploy target installs no
// archive library, and the app already ships large base64 payloads, so the
// document is unzipped here with Node's built-in zlib instead of adding a
// dependency. Only the single file we need is inflated, never the whole archive.

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

type ZipEntry = { name: string; compression: number; compressedSize: number; localOffset: number };

// Reads the central directory (authoritative even when a local header uses a
// data descriptor) and returns the entry for the requested member.
function findEntry(buffer: Buffer, wanted: string): ZipEntry | null {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("That file is not a readable Word document.");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_HEADER) break;
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (name === wanted) return { name, compression, compressedSize, localOffset };
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const { localOffset } = entry;
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
    throw new Error("That Word document is damaged and cannot be read.");
  }
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compression === 0) return data;
  if (entry.compression === 8) return inflateRawSync(data);
  throw new Error("That Word document uses an unsupported compression method.");
}

// Word splits text across <w:t> runs and uses <w:p> for paragraphs; tabs and
// explicit breaks matter because question prompts are often numbered lists.
function xmlToText(xml: string): string {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n");
  const text = withBreaks.replace(/<[^>]+>/g, "");
  return decodeXmlEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

export const DOCX_MAX_TEXT_CHARS = 24_000;

// Extracts the visible body text from a base64 .docx payload. Header/footer
// files are skipped deliberately — they hold page furniture, not questions.
export function extractDocxText(base64: string): string {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== LOCAL_FILE_HEADER) {
    throw new Error("That file is not a readable Word document.");
  }
  const entry = findEntry(buffer, "word/document.xml");
  if (!entry) throw new Error("That Word document has no readable content.");
  const text = xmlToText(readEntry(buffer, entry).toString("utf8"));
  if (!text) throw new Error("That Word document appears to be empty.");
  return text.slice(0, DOCX_MAX_TEXT_CHARS);
}
