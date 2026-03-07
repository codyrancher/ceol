export interface TemplateFile {
  path:    string;
  content: string;
}

export interface AppTemplate {
  id:          string;
  name:        string;
  description: string;
  logo:        (appName: string) => string;
  files:       (appName: string) => TemplateFile[];
  init:        (store: any, appName: string) => Promise<void>;
  destroy?:    (store: any, appName: string) => Promise<void>;
}
