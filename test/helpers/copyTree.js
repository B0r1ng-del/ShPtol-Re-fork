import fs from 'node:fs';
import path from 'node:path';

// Drop-in replacement for fs.cpSync(src, dest, { recursive: true }).
//
// Why it exists: on Windows, fs.cpSync crashes the whole process with
// 0xC0000409 (STATUS_STACK_BUFFER_OVERRUN) when the SOURCE path contains
// non-ASCII characters. Reproduced on Node 22.23.5, independent of file count,
// file size and destination:
//   fs.cpSync('H:/卫戍协议盟约/game/shared/studio', tmp) -> crash
//   fs.cpSync('H:/cptest',                        tmp) -> ok
//   fs.cpSync('H:/cptest',  'H:/卫戍协议盟约/x')        -> ok  (destination is fine)
// The walk below uses copyFileSync/mkdirSync, which are unaffected, so every
// test fixture that stages a directory goes through here.
//
// Supports the options the suite actually uses: filter(src, dest) and dereference.
export function copyTree(from, to, { filter, dereference = false } = {}) {
  const walk = (src, dest) => {
    if (filter && !filter(src, dest)) return;
    const st = dereference ? fs.statSync(src) : fs.lstatSync(src);
    if (st.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        walk(path.join(src, entry.name), path.join(dest, entry.name));
      }
      return;
    }
    if (!dereference && st.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(src), dest);
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  };
  walk(from, to);
}
