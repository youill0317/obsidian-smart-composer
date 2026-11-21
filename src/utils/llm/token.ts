import { Tiktoken, getEncoding } from 'js-tiktoken'

// TODO: Replace js-tiktoken with tiktoken library for better performance
// Note: tiktoken uses WebAssembly, requiring esbuild configuration

let encoder: Tiktoken | null = null

// Caution: tokenCount is computationally expensive for large inputs.
// Frequent use, especially on large files, may significantly impact performance.
export async function tokenCount(text: string): Promise<number> {
  encoder ??= getEncoding('cl100k_base')
  return encoder.encode(text).length
}
