// File System API helpers

export async function readTextFile(h) {
  const f = await h.getFile();
  return await f.text();
}

export async function writeTextFile(h, t) {
  const w = await h.createWritable();
  await w.write(t);
  await w.close();
}

export async function writeBlobFile(dh, name, file) {
  const fh = await dh.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(await file.arrayBuffer());
  await w.close();
  return fh;
}
