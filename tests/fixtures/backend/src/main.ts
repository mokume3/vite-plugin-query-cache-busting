export async function boot(): Promise<string> {
  const { lazyValue } = await import('./lazy')
  return lazyValue
}

// 呼び出しが無いと Vite が boot ごと tree-shake し、動的 import が manifest に現れなくなる
void boot()
