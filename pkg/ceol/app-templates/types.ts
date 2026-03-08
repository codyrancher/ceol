export interface TemplateFile {
  path:    string;
  content: string;
}

export interface DeployResult {
  env?: Array<{ name: string; value: string }>;
}

export interface AppTemplate {
  id:          string;
  name:        string;
  description: string;
  logo:        (appName: string) => string;
  files:       (appName: string) => TemplateFile[];
  init:        (store: any, appName: string) => Promise<void>;
  destroy?:    (store: any, appName: string) => Promise<void>;
  deploy?:     (store: any, appName: string, namespace: string, env: string) => Promise<DeployResult>;
}
