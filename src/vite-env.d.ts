/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_URL?: string;
  readonly VITE_FORMS_URL?: string; // optional override for the Forms tab endpoint
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
