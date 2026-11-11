export function backendLabel(backend) {
  if (!backend || backend === 'cpu') return 'Processor';
  if (backend === 'gpu' || backend === 'metal' || backend === 'cuda' || backend === 'vulkan') {
    return 'Video card';
  }
  return String(backend).toUpperCase();
}

export function computeNoun(platform) {
  return platform === 'darwin' ? 'graphics chip' : 'video card';
}
