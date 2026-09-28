import { fileURLToPath } from 'node:url'

/** A stack frame's file as a path of the platform's own, converted when it is a file:// URL, as an ES module's is. */
export function framePath(name: string, windows = process.platform === 'win32'): string {
  return name.startsWith('file://') ? fileURLToPath(name, { windows }) : name
}

/** A path as two are compared: without case on Windows, where a drive letter can come back upper or lower. */
export function comparablePath(file: string, windows = process.platform === 'win32'): string {
  return windows ? file.toLowerCase() : file
}
