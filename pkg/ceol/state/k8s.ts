export const CLUSTER_ID = 'local';
export const K8S_BASE = `/k8s/clusters/${ CLUSTER_ID }`;

export async function k8sRequest(store: any, method: string, path: string, body?: any, contentType?: string): Promise<any> {
  const opt: any = {
    url:     `${ K8S_BASE }/${ path }`,
    method,
    headers: { 'content-type': contentType || 'application/json', accept: 'application/json' },
  };

  if (body) {
    opt.data = body;
  }

  return await store.dispatch('management/request', { opt });
}
