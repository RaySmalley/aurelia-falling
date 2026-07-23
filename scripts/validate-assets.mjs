import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = new URL(
  "../public/assets/asset-manifest.json",
  import.meta.url,
);

function readUInt24LE(buffer, offset) {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16)
  );
}

function webpMetadata(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WEBP");
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + readUInt24LE(buffer, 24),
      height: 1 + readUInt24LE(buffer, 27),
      hasAlpha: (buffer[20] & 0x10) !== 0,
    };
  }
  if (chunk === "VP8 ") {
    assert.equal(buffer.toString("hex", 23, 26), "9d012a");
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      hasAlpha: false,
    };
  }
  if (chunk === "VP8L") {
    assert.equal(buffer[20], 0x2f);
    const bits = buffer.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
      hasAlpha: true,
    };
  }
  throw new Error(`Unsupported WebP chunk ${chunk}`);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const totals = { menu: 0, match: 0 };

for (const asset of manifest.assets) {
  const absolutePath = new URL(`../${asset.path}`, import.meta.url);
  const [buffer, metadata] = await Promise.all([
    readFile(absolutePath),
    stat(absolutePath),
  ]);
  const image = webpMetadata(buffer);
  assert.deepEqual(
    { width: image.width, height: image.height },
    { width: asset.width, height: asset.height },
    `${asset.path} dimensions drifted from the manifest`,
  );
  if (asset.alpha) {
    assert.equal(
      image.hasAlpha,
      true,
      `${asset.path} must preserve transparent atlas padding`,
    );
  }
  if (asset.atlas) {
    assert.ok(
      asset.width <= manifest.budgets.maxAtlasDimension &&
        asset.height <= manifest.budgets.maxAtlasDimension,
      `${asset.path} exceeds the atlas dimension budget`,
    );
    assert.equal(
      asset.atlas.columns * asset.atlas.frameWidth,
      asset.width,
      `${asset.path} columns do not align to exact cells`,
    );
    assert.equal(
      asset.atlas.rows * asset.atlas.frameHeight,
      asset.height,
      `${asset.path} rows do not align to exact cells`,
    );
  }
  for (const scope of asset.scopes) totals[scope] += metadata.size;
}

assert.ok(
  totals.menu <= manifest.budgets.menuCompressedBytes,
  `Menu payload ${totals.menu} exceeds ${manifest.budgets.menuCompressedBytes}`,
);
assert.ok(
  totals.match <= manifest.budgets.matchCompressedBytes,
  `Match payload ${totals.match} exceeds ${manifest.budgets.matchCompressedBytes}`,
);

console.log(
  `Assets valid from ${root}: menu ${totals.menu} B, match ${totals.match} B`,
);
